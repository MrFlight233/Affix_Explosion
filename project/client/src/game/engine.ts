// ============================================================
// 游戏引擎 — 状态管理、单存档、敌方BD、分步战斗（v3 统一实体模型）
// ============================================================

import {
  EntityDef, ItemInstance, DeploySlot, DefaultChildSpec,
  getEntityDef, getAffixDef, isStarter, genId,
  getEffectiveEntitySlots, countUsedSlots,
  findInTree, removeFromTreeChildren,
  ENTITY_DEFS, AFFIX_DEFS, getEntityCategory,
  getEffectiveValue, OnHitEffect,
} from './data';
import { data as dataApi, saves as savesApi } from '../api/client';

export type GamePhase = 1 | 2;

/** 6 位小数精度取整 — 用于所有 HP/耐力/浮点属性计算 */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ---- 战斗单位快照（v3：统一实体模型，可触发动作独立触发） ----

export interface CombatUnitSnapshot {
  instanceId: string;   // 唯一实例 ID（来自 ItemInstance）
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  totalStaminaRegen: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
  totalHpRegeneration: number;
  currentLoad: number;
  maxLoad: number;
  isOverloaded: boolean;
  activeWeapons: {
    name: string;
    actionTime: number;
    damage: number;
    staminaCost: number;
    targetType: string;
    targetOrder: string;
    priorityTarget: number | null;
    targetFaction: string;
    /** 拥有该武器的实体实例ID — 用于 entityOnHitEffects 查表 */
    ownerInstanceId: string;
  }[];
}

// ---- 战斗运行时（内部使用，时间线驱动） ----

/** 命中效果执行的上下文 — 明确区分三类实体 */
export interface OnHitContext {
  /** 启动端实体 — 攻击者侧的 HP/耐力池所在 */
  starter: CombatUnitRuntime;
  /** 被触发动作实体的 instanceId — 谁的武器命中了 */
  actionOwnerId: string;
  /** 被影响实体 — 承受伤害的目标 */
  target: CombatUnitRuntime;
  /** 本次造成的正伤害值 */
  damage: number;
}

export interface CombatWeaponRuntime {
  name: string;
  actionTime: number;
  remainingTime: number;  // ms 倒计时
  damage: number;
  staminaCost: number;
  targetType: string;
  targetOrder: string;
  priorityTarget: number | null;
  targetFaction: string;
  /** 拥有该武器的实体实例ID */
  ownerInstanceId: string;
}

export interface CombatUnitRuntime {
  instanceId: string;   // 唯一实例 ID
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
  hpRegeneration: number;
  isOverloaded: boolean;
  weapons: CombatWeaponRuntime[];
}

// ---- 战斗事件 ----

export interface CombatEvent {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  damage: number;
  targetHpAfter: number;
  targetMaxHp: number;
  effects: string[];
}

// ---- 游戏状态 ----

export interface GameState {
  gold: number;
  round: number;
  phase: GamePhase;
  warehouse: ItemInstance[];
  deploySlots: DeploySlot[];
  itemPool: string[];
  seed: number;
  currentEvents: string[];
  visitedEventMerchants: string[];
  growthStacks: Record<string, number>;
  quickWarehouseCollapsed: boolean;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export class GameEngine {
  state!: GameState;
  username = '';

  onStateChange?: () => void;
  onToast?: (msg: string) => void;
  rightPanel: string | null = null;

  // 战斗相关
  combatRunning = false;
  combatPaused = false;
  combatPlayerUnits: CombatUnitRuntime[] | null = null;
  combatEnemyUnits: CombatUnitRuntime[] | null = null;
  combatTime: number = 0;
  onCombatEvent?: (event: CombatEvent) => void;
  onCombatEnd?: (win: boolean, goldReward: number) => void;

  constructor() { this.resetState(); }

  resetState() {
    this.state = {
      gold: 90, round: 1, phase: 1,
      warehouse: [], deploySlots: [], itemPool: [], seed: Date.now(),
      currentEvents: [], visitedEventMerchants: [], growthStacks: {}, quickWarehouseCollapsed: false,
    };
    this.rebuildItemPool();
    // 冒险者自动部署到出场面板（不入仓库）
    const adv = this.createItem('adventurer', 'entity');
    this.state.deploySlots.push({ entity: adv, children: [] });
    this.rightPanel = null;
    this.notify();
  }

  rebuildItemPool() {
    this.state.itemPool = ENTITY_DEFS.filter(e => e.poolPrerequisite.length === 0).map(e => e.id);
  }

  notify() { this.onStateChange?.(); }
  toast(msg: string) { this.onToast?.(msg); }

  // ---- 物品操作 ----
  createItem(defId: string, type: 'entity' | 'affix', overrides?: Partial<EntityDef>): ItemInstance {
    const item: ItemInstance = { instanceId: genId(), defId, type };
    if (overrides && Object.keys(overrides).length > 0) {
      item.overrides = overrides;
    }
    if (type === 'entity') {
      const def = getEntityDef(defId);
      if (def) {
        const allChildren: ItemInstance[] = [];

        // 1. 模板级预装动态词条（创建 affix 类型的子项）
        if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
          for (const affixId of def.preloadedDynamicAffixes) {
            allChildren.push(this.createItem(affixId, 'affix'));
          }
        }

        // 2. 默认子实体
        if (def.defaultChildren && def.defaultChildren.length > 0) {
          for (const spec of def.defaultChildren) {
            const cid = typeof spec === 'string' ? spec : spec.defId;
            const childOverrides = typeof spec === 'string' ? undefined : spec.overrides;
            const child = this.createItem(cid, 'entity', childOverrides);

            if (typeof spec !== 'string') {
              // 合并 fixedAffixes：模板基础 + spec 附加（去重）
              if (spec.fixedAffixes && spec.fixedAffixes.length > 0) {
                const childDef = getEntityDef(cid);
                if (childDef) {
                  const merged = [...new Set([...childDef.fixedAffixes, ...spec.fixedAffixes])];
                  if (!child.overrides) child.overrides = {};
                  child.overrides.fixedAffixes = merged;
                }
              }
              // 子实体 spec 级预装动态词条
              if (spec.preloadedDynamicAffixes && spec.preloadedDynamicAffixes.length > 0) {
                if (!child.children) child.children = [];
                for (const affixId of spec.preloadedDynamicAffixes) {
                  child.children.push(this.createItem(affixId, 'affix'));
                }
              }
            }

            allChildren.push(child);
          }
        }

        // 3. 统一赋值（保留可能已有的 children，如递归调用时父级已设置）
        if (allChildren.length > 0) {
          item.children = [...(item.children || []), ...allChildren];
        }
      }
    }
    return item;
  }
  getDef(item: ItemInstance): EntityDef | any {
    return item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
  }
  addToWarehouse(item: ItemInstance) { this.state.warehouse.push(item); this.notify(); }
  removeFromWarehouse(instanceId: string): ItemInstance | undefined {
    const idx = this.state.warehouse.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return undefined;
    const [item] = this.state.warehouse.splice(idx, 1);
    this.notify(); return item;
  }
  /** 递归搜索：先查仓库，再递归查 deploySlots 树 */
  findItem(instanceId: string): ItemInstance | undefined {
    let item = this.state.warehouse.find(i => i.instanceId === instanceId);
    if (item) return item;
    for (const slot of this.state.deploySlots) {
      if (slot.entity.instanceId === instanceId) return slot.entity;
      // 递归搜索 entity.children（嵌套子实体）
      const found = findInTree(slot.entity, instanceId);
      if (found) return found;
      // 搜索 slot.children（启动端直属）
      for (const c of slot.children) {
        if (c.instanceId === instanceId) return c;
        const f = findInTree(c, instanceId);
        if (f) return f;
      }
    }
    return undefined;
  }

  /** 递归删除：返回值包含 slotIdx 和父 instanceId */
  removeFromDeploy(instanceId: string): { slotIdx: number; parentInstanceId: string | null } | null {
    for (let si = 0; si < this.state.deploySlots.length; si++) {
      const slot = this.state.deploySlots[si];
      // 检查启动端实体本身
      if (slot.entity.instanceId === instanceId) {
        this.state.deploySlots.splice(si, 1); this.notify();
        return { slotIdx: si, parentInstanceId: null };
      }
      // 检查 entity.children（嵌套子实体）
      const removed = removeFromTreeChildren(slot.entity, instanceId);
      if (removed) { this.notify(); return { slotIdx: si, parentInstanceId: slot.entity.instanceId }; }
      // 检查 slot.children（启动端直属）
      const ci = slot.children.findIndex(c => c.instanceId === instanceId);
      if (ci !== -1) {
        slot.children.splice(ci, 1); this.notify();
        return { slotIdx: si, parentInstanceId: null };
      }
      // 深度搜索 slot.children 的子树
      for (const c of slot.children) {
        const r = removeFromTreeChildren(c, instanceId);
        if (r) { this.notify(); return { slotIdx: si, parentInstanceId: c.instanceId }; }
      }
    }
    return null;
  }

  /** 递归查找父实体（通过 instanceId） */
  private findParentEntity(parentInstanceId: string | null, slotIdx: number): ItemInstance | null {
    if (parentInstanceId === null) return null; // target is slot itself
    for (const slot of this.state.deploySlots) {
      if (slot.entity.instanceId === parentInstanceId) return slot.entity;
      // 搜索 slot.children 树
      for (const c of slot.children) {
        const found = findInTree(c, parentInstanceId);
        if (found) return found;
      }
    }
    return null;
  }

  /** 判断实体能否放入目标位置 */
  canEquipToSlot(slotIdx: number, parentInstanceId: string | null, childDef: EntityDef): string | null {
    // 拥有 starter 词条的实体不能放入其他实体的槽位
    if (parentInstanceId !== null && isStarter(childDef)) return '拥有启动端词条的实体不能放入其他实体的槽位';

    if (parentInstanceId === null) {
      // 目标为第一层 → 检查第一层槽位上限
      const maxSlots = this.getFirstLayerSlots();
      let usedSlots = 0;
      for (const s of this.state.deploySlots) {
        const d = getEntityDef(s.entity.defId);
        if (d) usedSlots += d.slotCost;
      }
      // 如果要移动的物品已在第一层，先减去它的占用
      // (简化处理：检查是否已在 deploySlots 中)
      const alreadyDeployed = this.state.deploySlots.some(s => s.entity.defId === childDef.id);
      if (!alreadyDeployed && usedSlots + childDef.slotCost > maxSlots) {
        return `第一层槽位不足(剩${maxSlots - usedSlots},需${childDef.slotCost})`;
      }
      return null;
    }

    // 目标为嵌套实体
    const slot = this.state.deploySlots[slotIdx];
    if (!slot) return '槽位不存在';
    const parent = this.findParentEntity(parentInstanceId, slotIdx)!;
    if (!parent) return '父实体不存在';
    const parentDef = getEntityDef(parent.defId)!;
    if (!parentDef) return '未知父实体类型';

    // 拥有 starter 词条的实体不能放入其他实体的槽位
    if (isStarter(childDef)) return '拥有启动端词条的实体不能放入其他实体的槽位';

    // 计算有效槽位和已用槽位
    const effectiveSlots = getEffectiveEntitySlots(parentDef);
    const used = countUsedSlots(parent);
    if (childDef.slotCost > effectiveSlots - used)
      return `槽位不足(剩${effectiveSlots - used},需${childDef.slotCost})`;
    return null;
  }

  /** 将物品移动到出场面板指定位置（支持嵌套父实体） */
  moveToDeploy(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null): string | null {
    const def = this.getDef(item); if (!def) return '未知物品';
    if (item.type === 'entity') {
      const edef = def as EntityDef;
      if (isStarter(edef)) {
        if (targetSlotIdx !== undefined) return '启动端只能放在第一层级';
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        this.state.deploySlots.push({ entity: item, children: [] });
        this.notify(); return null;
      } else {
        if (targetSlotIdx === undefined) return '装备需放入启动端的槽位';
        const pid = parentInstanceId ?? null;
        const err = this.canEquipToSlot(targetSlotIdx, pid, edef); if (err) return err;
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        // 插入到正确的父实体
        if (pid !== null) {
          const parentEntity = this.findParentEntity(pid, targetSlotIdx);
          if (!parentEntity) return '父实体不存在';
          if (!parentEntity.children) parentEntity.children = [];
          parentEntity.children.push(item);
        } else {
          this.state.deploySlots[targetSlotIdx].children.push(item);
        }
        this.notify(); return null;
      }
    }
    if (item.type === 'affix') {
      if (targetSlotIdx === undefined) return '词条需放入实体槽位';
      const pid = parentInstanceId ?? null;
      this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
      if (pid !== null) {
        const parentEntity = this.findParentEntity(pid, targetSlotIdx);
        if (!parentEntity) return '父实体不存在';
        if (!parentEntity.children) parentEntity.children = [];
        parentEntity.children.push(item);
      } else {
        this.state.deploySlots[targetSlotIdx].children.push(item);
      }
      this.notify(); return null;
    }
    return '无法放置';
  }
  moveToWarehouse(item: ItemInstance) {
    this.removeFromDeploy(item.instanceId); this.state.warehouse.push(item); this.notify();
  }
  sellItem(item: ItemInstance): number | null {
    const def = this.getDef(item); if (!def) return null;
    const bv = 'costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value;
    const price = Math.floor(bv / 2);
    const wi = this.state.warehouse.findIndex(i => i.instanceId === item.instanceId);
    if (wi !== -1) { this.state.warehouse.splice(wi, 1); this.state.gold += price; this.notify(); return price; }
    const r = this.removeFromDeploy(item.instanceId);
    if (r) { this.state.gold += price; this.notify(); return price; }
    return null;
  }
  buyItem(item: ItemInstance): string | null {
    const def = this.getDef(item);
    const price = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price; this.addToWarehouse(item); return null;
  }
  buyAndEquip(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null): string | null {
    const def = this.getDef(item);
    const price = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price;
    const ni = this.createItem(item.defId, item.type);
    return this.moveToDeploy(ni, targetSlotIdx, parentInstanceId);
  }

  /** 生成商店物品列表（不限数量，仅价值限制） */
  generateShopItems(filter: 'all' | 'entity' | 'affix'): ItemInstance[] {
    const cap = this.getMerchantValueCap();
    const items: ItemInstance[] = [];

    if (filter === 'all' || filter === 'entity') {
      for (const def of ENTITY_DEFS) {
        if (def.value > cap) continue;
        if (def.poolPrerequisite.length > 0 && !def.poolPrerequisite.every(p => this.state.itemPool.includes(p))) continue;
        items.push(this.createItem(def.id, 'entity'));
      }
    }

    if (filter === 'all' || filter === 'affix') {
      for (const def of AFFIX_DEFS) {
        if (Math.abs(def.costValue) > cap) continue;
        if (def.poolPrerequisite.length > 0 && !def.poolPrerequisite.every(p => this.state.itemPool.includes(p))) continue;
        items.push(this.createItem(def.id, 'affix'));
      }
    }

    return items;
  }

  /** 递归查找指定 instanceId 的父实体的 children 数组 */
  private getChildrenArray(parentInstanceId: string | null, slotIdx: number): ItemInstance[] | null {
    if (parentInstanceId === null) {
      return this.state.deploySlots[slotIdx]?.children ?? null;
    }
    // 搜索树
    for (const slot of this.state.deploySlots) {
      if (slot.entity.instanceId === parentInstanceId) return slot.entity.children || null;
      for (const c of slot.children) {
        const found = findInTree(c, parentInstanceId);
        if (found) return found.children || null;
      }
    }
    return null;
  }

  /** 拖拽排序：在同级 children 中移动元素 */
  reorderChildren(parentInstanceId: string | null, slotIdx: number, fromIndex: number, toIndex: number): void {
    const arr = this.getChildrenArray(parentInstanceId, slotIdx);
    if (!arr || fromIndex < 0 || fromIndex >= arr.length) return;
    if (toIndex < 0) toIndex = 0;
    if (toIndex >= arr.length) toIndex = arr.length - 1;
    if (fromIndex === toIndex) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
    this.notify();
  }

  // 排序
  moveDeploySlot(from: number, to: number) {
    if (from === to) return; const [s] = this.state.deploySlots.splice(from, 1);
    this.state.deploySlots.splice(to, 0, s); this.notify();
  }
  moveWarehouseItem(from: number, to: number) {
    if (from === to) return; const [item] = this.state.warehouse.splice(from, 1);
    this.state.warehouse.splice(to, 0, item); this.notify();
  }

  // ---- 阶段 ----
  getPhaseLabel(): string {
    const p = ['', '探险', '战斗'];
    return `回合${this.state.round} ${p[this.state.phase]}阶段`;
  }
  getMerchantValueCap(): number { return this.state.round * 10; }
  /** 获取第一层槽位上限 */
  getFirstLayerSlots(): number { return this.state.round; }

  nextPhase() {
    if (this.state.phase === 1) {
      // 探险 → 战斗
      this.state.phase = 2;
    } else {
      // 战斗 → 下一轮探险
      this.state.round++;
      this.state.phase = 1;
      this.state.visitedEventMerchants = [];
      this.generateEvents();
      // 探险阶段金币
      const exploreGold = Math.floor((this.state.round + 1) / 2) * 10;
      this.state.gold += exploreGold;
      this.autoSave();
    }
    this.notify();
  }

  // ---- 事件 ----
  generateEvents() {
    const evts = ['good_merchant', 'entity_merchant', 'affix_merchant', 'discount_merchant', 'lottery'];
    const rand = seededRandom(this.state.seed + this.state.round * 100 + this.state.phase);
    const picked: string[] = [], pool = [...evts];
    for (let i = 0; i < 3 && pool.length > 0; i++)
      picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    this.state.currentEvents = picked;
  }
  getEventName(id: string): string {
    const n: Record<string,string> = { good_merchant:'好物商人', entity_merchant:'实体好物商人',
      affix_merchant:'词条好物商人', discount_merchant:'折扣商人', lottery:'抽奖' };
    return n[id] || id;
  }

  /** 递归计算战斗快照：遍历嵌套的装备树，聚合所有加成（v5: 支持 ItemInstance.overrides） */
  /** 遍历实体树，收集每个 isActive 实体的直属 onHitEffects，注册到 Map */
  private collectEntityOnHitEffects(
    children: ItemInstance[],
    map: Map<string, OnHitEffect[]>,
  ): void {
    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;
        const isActive = getEffectiveValue(child, 'isActive') ?? cdef.isActive;

        if (isActive) {
          // 提取该实体直属 affix 的 onHitEffects
          const effects: OnHitEffect[] = [];
          if (child.children) {
            for (const sub of child.children) {
              if (sub.type === 'affix') {
                const adef = getAffixDef(sub.defId);
                if (adef?.onHitEffects) {
                  for (const e of adef.onHitEffects) {
                    effects.push({ type: e.type, params: { ...e.params } });
                  }
                }
              }
            }
          }
          // 始终注册，确保 starter 传播能覆盖所有 isActive 实体
          const existing = map.get(child.instanceId) || [];
          map.set(child.instanceId, [...existing, ...effects]);
        }

        // 递归处理嵌套子实体
        if (child.children && child.children.length > 0) {
          this.collectEntityOnHitEffects(child.children, map);
        }
      }
    }
  }

  private collectFromChildren(
    children: ItemInstance[],
    growthStack: number,
  ): {
    totalStaminaRegenerationBonus: number; totalStaminaBonus: number;
    totalHpBonus: number; totalHpRegenerationBonus: number;
    totalLoad: number; passiveDamageBonus: number;
    weapons: CombatUnitSnapshot['activeWeapons'];
  } {
    let totalStaminaRegenerationBonus = 0, totalStaminaBonus = 0, totalHpBonus = 0, totalHpRegenerationBonus = 0;
    let totalLoad = 0, passiveDamageBonus = 0;
    const weapons: CombatUnitSnapshot['activeWeapons'] = [];

    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;

        // v5: 使用 getEffectiveValue 读取，支持 ItemInstance.overrides
        totalStaminaRegenerationBonus += Number(getEffectiveValue(child, 'staminaRegenerationBonus') ?? 0);
        totalStaminaBonus += Number(getEffectiveValue(child, 'staminaBonus') ?? 0);
        totalHpBonus += Number(getEffectiveValue(child, 'hpBonus') ?? 0);
        totalHpRegenerationBonus += Number(getEffectiveValue(child, 'hpRegenerationBonus') ?? 0);
        totalLoad += Number(getEffectiveValue(child, 'weight') ?? 0);

        const isActive = getEffectiveValue(child, 'isActive') ?? cdef.isActive;
        if (isActive) {
          const wDamage = Number(getEffectiveValue(child, 'damage') ?? 0);
          const weaponDamage = wDamage + growthStack;
          // 被动伤害加成统一在 calculateCombatSnapshots 阶段应用，避免双重累加
          weapons.push({
            name: String(getEffectiveValue(child, 'name') ?? cdef.name),
            actionTime: Number(getEffectiveValue(child, 'actionTime') ?? 0),
            damage: weaponDamage,
            staminaCost: Number(getEffectiveValue(child, 'staminaCost') ?? 0),
            targetType: String((getEffectiveValue(child, 'targetType') ?? cdef.targetType) || '近战'),
            targetOrder: String((getEffectiveValue(child, 'targetOrder') ?? cdef.targetOrder) || '从上往下'),
            priorityTarget: (getEffectiveValue(child, 'priorityTarget') ?? cdef.priorityTarget) as number | null,
            targetFaction: String((getEffectiveValue(child, 'targetFaction') ?? cdef.targetFaction) || '敌人'),
            ownerInstanceId: child.instanceId,
          });
        } else {
          // isActive=false 实体 → 累加 damageBonus 到被动池
          passiveDamageBonus += Number(getEffectiveValue(child, 'damageBonus') ?? 0);
          // 递归处理容器内的嵌套子项
          if (child.children && child.children.length > 0) {
            const nested = this.collectFromChildren(child.children, growthStack);
            totalStaminaRegenerationBonus += nested.totalStaminaRegenerationBonus;
            totalStaminaBonus += nested.totalStaminaBonus;
            totalHpBonus += nested.totalHpBonus;
            totalHpRegenerationBonus += nested.totalHpRegenerationBonus;
            totalLoad += nested.totalLoad;
            passiveDamageBonus += nested.passiveDamageBonus;
            for (const w of nested.weapons) weapons.push(w);
          }
        }
      }
      if (child.type === 'affix') {
        const adef = getAffixDef(child.defId);
        if (adef?.id === 'strength') {
          passiveDamageBonus += adef.value;
        }
      }
    }
    return { totalStaminaRegenerationBonus, totalStaminaBonus, totalHpBonus, totalHpRegenerationBonus, totalLoad, passiveDamageBonus, weapons };
  }

  /** 从 DeploySlot 构建 CombatUnitSnapshot（v4：递归嵌套）。可传入自定义 slots 用于模拟对战。 */
  calculateCombatSnapshots(slots?: DeploySlot[]): { snapshots: CombatUnitSnapshot[]; onHitEffects: Map<string, OnHitEffect[]> } {
    const deploySlots = slots ?? this.state.deploySlots;
    const units: CombatUnitSnapshot[] = [];
    // ★ 构建实体→命中效果映射表（跨所有 slot 累加）
    const entityOnHitEffects = new Map<string, OnHitEffect[]>();
    const registerEffects = (instanceId: string, effects: OnHitEffect[]) => {
      if (effects.length === 0) return;
      const existing = entityOnHitEffects.get(instanceId) || [];
      entityOnHitEffects.set(instanceId, [...existing, ...effects]);
    };
    for (const slot of deploySlots) {
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;

      const growthStack = this.state.growthStacks[slot.entity.instanceId] || 0;
      // 合并 entity 自身的默认子实体 + slot 的用户挂载物品
      const allChildren = [...(slot.entity.children || []), ...slot.children];
      const collected = isStarter(edef)
        ? this.collectFromChildren(allChildren, growthStack)
        : { totalStaminaRegenerationBonus: 0, totalStaminaBonus: 0, totalHpBonus: 0, totalHpRegenerationBonus: 0, totalLoad: 0, passiveDamageBonus: 0, weapons: [] };

      // ★ 启动端自身的被动加成也对自己生效
      if (isStarter(edef)) {
        collected.totalStaminaRegenerationBonus += edef.staminaRegenerationBonus;
        collected.totalStaminaBonus += edef.staminaBonus;
        collected.totalHpBonus += edef.hpBonus;
        collected.totalHpRegenerationBonus += edef.hpRegenerationBonus;
        collected.passiveDamageBonus += Number(getEffectiveValue(slot.entity, 'damageBonus') ?? edef.damageBonus ?? 0);
      }

      // ★ 启动端自身如果是主动实体，也加入武器列表
      if (isStarter(edef)) {
        const selfIsActive = getEffectiveValue(slot.entity, 'isActive') ?? edef.isActive;
        if (selfIsActive) {
          collected.weapons.unshift({
            name: edef.name,
            actionTime: Number(getEffectiveValue(slot.entity, 'actionTime') ?? 0),
            damage: Number(getEffectiveValue(slot.entity, 'damage') ?? 0) + growthStack,
            staminaCost: Number(getEffectiveValue(slot.entity, 'staminaCost') ?? 0),
            targetType: String((getEffectiveValue(slot.entity, 'targetType') ?? edef.targetType) || '近战'),
            targetOrder: String((getEffectiveValue(slot.entity, 'targetOrder') ?? edef.targetOrder) || '从上往下'),
            priorityTarget: (getEffectiveValue(slot.entity, 'priorityTarget') ?? edef.priorityTarget) as number | null,
            targetFaction: String((getEffectiveValue(slot.entity, 'targetFaction') ?? edef.targetFaction) || '敌人'),
            ownerInstanceId: slot.entity.instanceId,
          });
        }
      }

      // strength 词条加成 + onHitEffects 收集
      let extraDmg = 0;
      // ★ starter 直属 onHitEffects 传播源（slot.entity.children + slot.children 的 affix 都传播）
      const starterOnHitEffects: OnHitEffect[] = [];

      if (isStarter(edef)) {
        // 步骤1：遍历子树，收集每个 isActive 实体的自身效果
        this.collectEntityOnHitEffects(allChildren, entityOnHitEffects);
        // starter 自身若是 isActive，也收集其直属 affix 效果
        if (isStarter(edef)) {
          const starterEffects: OnHitEffect[] = [];
          for (const c of (slot.entity.children || [])) {
            if (c.type === 'affix') {
              const adef = getAffixDef(c.defId);
              if (adef?.onHitEffects) {
                for (const e of adef.onHitEffects) {
                  starterEffects.push({ type: e.type, params: { ...e.params } });
                }
              }
            }
          }
          if (starterEffects.length > 0) {
            registerEffects(slot.entity.instanceId, starterEffects);
            // ★ 同时加入传播列表，使子树所有 isActive 实体也能获得此效果
            starterOnHitEffects.push(...starterEffects);
          }
        }

        // 步骤2：收集 slot.children 中的 affix onHitEffects
        for (const c of slot.children) {
          if (c.type === 'affix') {
            const adef = getAffixDef(c.defId);
            if (adef?.id === 'strength') extraDmg += adef.value;
            if (adef?.onHitEffects) {
              for (const e of adef.onHitEffects) {
                starterOnHitEffects.push({ type: e.type, params: { ...e.params } });
              }
            }
          }
        }

        // 步骤3：传播 — 将 starter 效果追加到子树每个 isActive 实体的 map entry
        if (starterOnHitEffects.length > 0) {
          for (const [instanceId] of entityOnHitEffects) {
            registerEffects(instanceId, starterOnHitEffects);
          }
        }

        const netPassive = collected.passiveDamageBonus - extraDmg;
        for (const w of collected.weapons) {
          // 符号感知：正的被动加成只影响正伤害武器，负的只影响负伤害（治疗）武器
          if ((netPassive > 0 && w.damage > 0) || (netPassive < 0 && w.damage < 0)) {
            w.damage += netPassive;
          }
        }
      }

      const hp = edef.hp + collected.totalHpBonus;
      const maxStamina = edef.maxStamina + collected.totalStaminaBonus;
      const totalStaminaRegen = edef.staminaRegen + collected.totalStaminaRegenerationBonus;
      const totalHpRegen = edef.hpRegen + collected.totalHpRegenerationBonus;
      const isOverloaded = collected.totalLoad > edef.maxLoad;

      units.push({
        instanceId: slot.entity.instanceId,
        entityId: edef.id,
        entityName: edef.name + (isStarter(edef) ? '' : '(木桩)'),
        totalHp: hp,
        currentHp: hp,
        totalStaminaRegen,
        maxStamina,
        currentStamina: maxStamina,
        staminaRegen: edef.staminaRegen,
        totalHpRegeneration: totalHpRegen,
        currentLoad: collected.totalLoad,
        maxLoad: edef.maxLoad,
        isOverloaded,
        activeWeapons: collected.weapons,
      });
    }
    return { snapshots: units, onHitEffects: entityOnHitEffects };
  }

  // ---- 敌方 BD 生成（v3：产出 CombatUnitSnapshot[]） ----
  generateEnemyBD(): CombatUnitSnapshot[] {
    const r = this.state.round;
    const rand = seededRandom(this.state.seed + r * 777);
    const count = r === 1 ? 1 : r === 2 ? 2 : 3;

    const enemyTemplates = [
      { name: '重装步兵', hpBase: 25, maxStamina:60, staminaRegen:5, maxLoad:25, atk: '近战', ao: '从上往下', pt: 1 as number | null },
      { name: '哥布林战士', hpBase: 15, maxStamina:50, staminaRegen:8, maxLoad:15, atk: '近战', ao: '从上往下', pt: 1 as number | null },
      { name: '哥布林弓手', hpBase: 12, maxStamina:55, staminaRegen:7, maxLoad:12, atk: '远程', ao: '从下往上', pt: null as number | null },
      { name: '骷髅法师', hpBase: 10, maxStamina:70, staminaRegen:6, maxLoad:10, atk: '远程', ao: '从下往上', pt: 2 as number | null },
      { name: '暗影刺客', hpBase: 14, maxStamina:45, staminaRegen:9, maxLoad:12, atk: '近战', ao: '从上往下', pt: 1 as number | null },
    ];

    const weaponTemplates = [
      { name: '生锈短剑', actionTime: 2000, damage: 3, staminaCost: 10, targetType: '近战', targetOrder: '从上往下', priorityTarget: 1 as number | null, targetFaction: '敌人' },
      { name: '猎弓', actionTime: 2100, damage: 4, staminaCost: 12, targetType: '远程', targetOrder: '从下往上', priorityTarget: null as number | null, targetFaction: '敌人' },
      { name: '木盾', actionTime: 0, damage: 0, staminaCost: 0, targetType: '近战', targetOrder: '从上往下', priorityTarget: 1 as number | null, targetFaction: '敌人' },
      { name: '骨杖', actionTime: 2500, damage: 5, staminaCost: 15, targetType: '远程', targetOrder: '从下往上', priorityTarget: 3 as number | null, targetFaction: '敌人' },
    ];

    const units: CombatUnitSnapshot[] = [];

    for (let i = 0; i < count; i++) {
      const t = enemyTemplates[Math.floor(rand() * enemyTemplates.length)];
      const mult = 1 + (r - 1) * 0.7;
      const hp = Math.floor(t.hpBase * mult * (0.8 + rand() * 0.4));

      const weapons: CombatUnitSnapshot['activeWeapons'] = [];
      // 50% 概率装备武器
      if (rand() > 0.5) {
        const wt = weaponTemplates[Math.floor(rand() * weaponTemplates.length)];
        const wdmg = Math.floor(wt.damage * mult * (0.8 + rand() * 0.4));
        weapons.push({ ...wt, damage: wdmg > 0 ? wdmg : wt.damage, ownerInstanceId: `enemy_${i}` });
      } else {
        // 基础攻击（空手）
        weapons.push({
          name: '基础攻击',
          actionTime: 2000 + Math.floor(rand() * 1500),
          damage: Math.floor((2 + rand() * 3) * mult),
          staminaCost: 8,
          targetType: t.atk,
          targetOrder: t.ao,
          priorityTarget: t.pt,
          targetFaction: '敌人',
          ownerInstanceId: `enemy_${i}`,
        });
      }

      units.push({
        instanceId: `enemy_${i}`,
        entityId: `enemy_${i}`,
        entityName: `${t.name} Lv${r}`,
        totalHp: hp,
        currentHp: hp,
        totalStaminaRegen: t.staminaRegen,
        maxStamina: t.maxStamina,
        currentStamina: t.maxStamina,
        staminaRegen: t.staminaRegen,
        totalHpRegeneration: 0,
        currentLoad: 0,
        maxLoad: t.maxLoad,
        isOverloaded: false,
        activeWeapons: weapons,
      });
    }

    return units;
  }

  /** 从 CombatUnitSnapshot 转换为运行时结构 */
  private buildCombatRuntime(units: CombatUnitSnapshot[]): CombatUnitRuntime[] {
    return units.map(u => ({
      instanceId: u.instanceId,
      entityId: u.entityId,
      entityName: u.entityName,
      totalHp: u.totalHp,
      currentHp: u.currentHp,
      maxStamina: u.maxStamina,
      currentStamina: u.currentStamina,
      staminaRegen: u.totalStaminaRegen, // 使用包含装备加成的总耐力恢复
      hpRegeneration: u.totalHpRegeneration,
      isOverloaded: u.isOverloaded,
      weapons: u.activeWeapons.map(w => ({
        name: w.name,
        actionTime: w.actionTime,
        remainingTime: w.actionTime, // 初始倒计时 = actionTime
        damage: w.damage,
        staminaCost: w.staminaCost,
        targetType: w.targetType,
        targetOrder: w.targetOrder,
        priorityTarget: w.priorityTarget,
        targetFaction: w.targetFaction,
        ownerInstanceId: w.ownerInstanceId,
      })),
    }));
  }

  /** 根据 targetFaction 选择目标 */
  private selectTarget(
    weapon: CombatWeaponRuntime,
    playerUnits: CombatUnitRuntime[],
    enemyUnits: CombatUnitRuntime[],
    isPlayer: boolean,
  ): CombatUnitRuntime | null {
    const faction = weapon.targetFaction || '敌人';

    // 确定候选池
    let candidates: CombatUnitRuntime[];
    if (faction === '友方') {
      candidates = isPlayer ? playerUnits : enemyUnits;
    } else if (faction === '所有') {
      // 双方都搜索：先搜对方，再搜己方
      const opposing = isPlayer ? enemyUnits : playerUnits;
      const friendly = isPlayer ? playerUnits : enemyUnits;
      candidates = [...opposing, ...friendly];
    } else {
      // '敌人'（默认）：对方
      candidates = isPlayer ? enemyUnits : playerUnits;
    }

    const alive = candidates.filter(c => c.currentHp > 0);
    if (alive.length === 0) return null;

    // priorityTarget: 1-based index into candidates list
    if (weapon.priorityTarget !== null) {
      const idx = weapon.priorityTarget - 1;
      if (idx >= 0 && idx < candidates.length && candidates[idx].currentHp > 0) {
        return candidates[idx];
      }
    }

    // fallback: targetOrder 搜索
    if (weapon.targetOrder === '从下往上') {
      for (let i = alive.length - 1; i >= 0; i--) return alive[i];
    }
    // 从上往下（默认）
    return alive[0];
  }

  /** 递归检查实体树中是否有 growth 词条 */
  private hasGrowthAffix(children: ItemInstance[]): boolean {
    for (const c of children) {
      if (c.type === 'affix' && c.defId === 'growth') return true;
      if (c.children && this.hasGrowthAffix(c.children)) return true;
    }
    return false;
  }

  /** 处理武器命中后的触发效果。
   *  组装 OnHitContext，通过 entityOnHitEffects Map 查表获取效果列表。 */
  private resolveOnHitEffects(
    weapon: CombatWeaponRuntime,
    starter: CombatUnitRuntime,
    target: CombatUnitRuntime,
    damage: number,
    onHitEffects: Map<string, OnHitEffect[]>,
  ): string[] {
    const labels: string[] = [];
    if (damage <= 0) return labels; // 仅正伤害触发

    const effects = onHitEffects.get(weapon.ownerInstanceId);
    if (!effects || effects.length === 0) return labels;

    const ctx: OnHitContext = {
      starter,
      actionOwnerId: weapon.ownerInstanceId,
      target,
      damage,
    };

    for (const effect of effects) {
      const label = this.executeOnHitEffect(effect, ctx);
      if (label) labels.push(label);
    }

    return labels;
  }

  /** 执行单个命中效果。返回战斗日志标签或 null。
   *  扩展点：新增效果类型在此方法内加 case 分支。 */
  private executeOnHitEffect(
    effect: OnHitEffect,
    ctx: OnHitContext,
  ): string | null {
    switch (effect.type) {

      // ──── 吸血：回复启动端HP ────
      case 'life_steal': {
        const pct = effect.params.percent ?? 0;
        const amt = effect.params.amount ?? 0;
        const heal = Math.round(ctx.damage * pct / 100) + amt;
        if (heal <= 0) return null;
        ctx.starter.currentHp = round6(Math.min(ctx.starter.currentHp + heal, ctx.starter.totalHp));
        return `吸血+${heal}`;
      }

      // ──── 削耐：削减被影响实体的耐力 ────
      case 'stamina_drain': {
        const pct = effect.params.percent ?? 0;
        const amt = effect.params.amount ?? 0;
        const drain = Math.round(ctx.damage * pct / 100) + amt;
        if (drain <= 0) return null;
        ctx.target.currentStamina = round6(Math.max(ctx.target.currentStamina - drain, 0));
        return `削耐-${drain}`;
      }

      default:
        return null;
    }
  }

  /** 固定时间步长战斗引擎（内部核心，不含状态管理）。
   *  每 100ms 推进一次，恢复和武器冷却均匀递减。
   *  runCombat 和 runSimCombat 共用此引擎，区别仅在于 BD 来源和战后处理。
   *  isCancelled 回调用于战斗中途退出时立即中断引擎。 */
  private async _runBattleCore(
    playerUnits: CombatUnitRuntime[],
    enemyUnits: CombatUnitRuntime[],
    playerOnHitEffects: Map<string, OnHitEffect[]>,
    enemyOnHitEffects: Map<string, OnHitEffect[]>,
    onEvent: (evt: CombatEvent) => void,
    isPaused?: () => boolean,
    isCancelled?: () => boolean,
  ): Promise<{ win: boolean }> {
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    const TICK_MS = 100; // 固定时间步长

    this.combatTime = 0;
    const MAX_COMBAT_TIME = 120000; // 2 分钟战斗时间上限
    const PENALTY_START_MS = 60000; // 60秒后开始软狂暴
    let lastPenaltySecond = 0;

    while (
      playerUnits.some(u => u.currentHp > 0) &&
      enemyUnits.some(e => e.currentHp > 0) &&
      this.combatTime < MAX_COMBAT_TIME
    ) {
      // 取消检查
      if (isCancelled?.()) break;

      // 暂停检查
      while (isPaused?.()) {
        await delay(50);
      }

      await delay(TICK_MS);

      this.combatTime += TICK_MS;

      // 构建存活单位的武器列表
      const allWeapons: { unit: CombatUnitRuntime; weapon: CombatWeaponRuntime; isPlayer: boolean }[] = [];
      for (const u of playerUnits) {
        if (u.currentHp <= 0) continue;
        for (const w of u.weapons) {
          allWeapons.push({ unit: u, weapon: w, isPlayer: true });
        }
      }
      for (const e of enemyUnits) {
        if (e.currentHp <= 0) continue;
        for (const w of e.weapons) {
          allWeapons.push({ unit: e, weapon: w, isPlayer: false });
        }
      }

      // 推进时间 + 耐力恢复 + 生命恢复
      for (const u of playerUnits) {
        if (u.currentHp <= 0) continue;
        u.currentStamina = round6(Math.min(u.currentStamina + u.staminaRegen * TICK_MS / 1000, u.maxStamina));
        u.currentHp = round6(Math.min(u.currentHp + u.hpRegeneration * TICK_MS / 1000, u.totalHp));
        for (const w of u.weapons) w.remainingTime -= TICK_MS;
      }
      for (const e of enemyUnits) {
        if (e.currentHp <= 0) continue;
        e.currentStamina = round6(Math.min(e.currentStamina + e.staminaRegen * TICK_MS / 1000, e.maxStamina));
        e.currentHp = round6(Math.min(e.currentHp + e.hpRegeneration * TICK_MS / 1000, e.totalHp));
        for (const w of e.weapons) w.remainingTime -= TICK_MS;
      }

      // 触发 remainingTime <= 0 的武器
      for (const { unit, weapon, isPlayer } of allWeapons) {
        if (unit.currentHp <= 0) continue;
        if (weapon.remainingTime > 0) continue;

        const overloadPenalty = unit.isOverloaded ? 1.5 : 1.0;
        const effectiveCost = weapon.staminaCost * overloadPenalty;
        const damage = weapon.damage; // 可为负值=恢复HP，无最小值限制

        if (unit.currentStamina < effectiveCost) {
          // 耐力不足，下个 tick 再试
          weapon.remainingTime = 0;
          continue;
        }

        // 消耗耐力
        unit.currentStamina = round6(unit.currentStamina - effectiveCost);

        // 选择目标（根据 targetFaction 决定从哪方选）
        const target = this.selectTarget(weapon, playerUnits, enemyUnits, isPlayer);
        if (!target) continue;

        // 计算伤害（dmg 可为负值=恢复HP）
        const dmg = damage;
        target.currentHp = round6(Math.min(target.currentHp - dmg, target.totalHp));

        // ★ 命中效果结算（根据阵营选择正确的 Map）
        const hitMap = isPlayer ? playerOnHitEffects : enemyOnHitEffects;
        const onHitLabels = this.resolveOnHitEffects(weapon, unit, target, dmg, hitMap);

        // 重置倒计时
        weapon.remainingTime = weapon.actionTime;

        // 发射事件
        const effects: string[] = [];
        if (onHitLabels.length > 0) effects.push(...onHitLabels);
        if (Math.abs(dmg) >= target.totalHp * 0.3) effects.push(dmg > 0 ? '重击' : '大回复');

        onEvent({
          time: Math.round(this.combatTime),
          actorName: unit.entityName,
          weaponName: weapon.name,
          targetName: target.entityName,
          damage: dmg,
          targetHpAfter: Math.min(Math.max(target.currentHp, 0), target.totalHp),
          targetMaxHp: target.totalHp,
          effects,
        });

        // 击杀事件
        if (target.currentHp <= 0) {
          onEvent({
            time: Math.round(this.combatTime),
            actorName: '',
            weaponName: '',
            targetName: target.entityName,
            damage: 0,
            targetHpAfter: 0,
            targetMaxHp: target.totalHp,
            effects: ['击杀'],
          });
        }
      }

      // ── 60秒超时惩罚（软狂暴）──
      if (this.combatTime > PENALTY_START_MS) {
        const overtimeSeconds = Math.floor((this.combatTime - PENALTY_START_MS) / 1000);
        if (overtimeSeconds > lastPenaltySecond) {
          lastPenaltySecond = overtimeSeconds;
          const penaltyDamage = overtimeSeconds * 10;

          const applyPenalty = (units: CombatUnitRuntime[]) => {
            for (const u of units) {
              if (u.currentHp <= 0) continue;
              u.currentHp = round6(Math.max(u.currentHp - penaltyDamage, 0));
              if (u.currentHp <= 0) {
                onEvent({
                  time: Math.round(this.combatTime), actorName: '', weaponName: '',
                  targetName: u.entityName, damage: penaltyDamage,
                  targetHpAfter: 0, targetMaxHp: u.totalHp, effects: ['击杀'],
                });
              }
            }
          };
          applyPenalty(playerUnits);
          applyPenalty(enemyUnits);

          onEvent({
            time: Math.round(this.combatTime), actorName: '', weaponName: '',
            targetName: '超时惩罚', damage: penaltyDamage,
            targetHpAfter: 0, targetMaxHp: 0,
            effects: [`${overtimeSeconds}秒`],
          });
        }
      }

      // 更新战斗状态供 UI 轮询
      this.combatPlayerUnits = playerUnits;
      this.combatEnemyUnits = enemyUnits;
    }

    // 胜负判定：双方同灭/120秒上限/敌方全灭 → 玩家胜
    const playerAlive = playerUnits.some(u => u.currentHp > 0);
    const enemyAlive = enemyUnits.some(e => e.currentHp > 0);
    const win = this.combatTime >= MAX_COMBAT_TIME || playerAlive || !enemyAlive;
    return { win };
  }

  /** 正式战斗：上传 BD → 抽取对手 → 运行引擎 → 结算奖励。
   *  BD 来源：engine.state.deploySlots。对手来源：在线对战池。 */
  async runCombat(
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean, gold: number) => void,
  ) {
    const { snapshots, onHitEffects: playerOnHitEffects } = this.calculateCombatSnapshots();

    // 1. 上传 BD 到对战池（静默，失败不影响战斗）
    try {
      const r = await dataApi.uploadBD(this.state.round, this.state.deploySlots);
      console.log('[runCombat] 上传 BD 成功', { round: this.state.round, id: r.id, slots: this.state.deploySlots.length });
    } catch (e) { console.error('[runCombat] 上传 BD 失败', e); }

    // 2. 从对战池抽取对手
    let enemySnaps: CombatUnitSnapshot[] | null = null;
    let enemyOnHitEffects: Map<string, OnHitEffect[]> = new Map();
    try {
      const { opponent } = await dataApi.getBattlePool(this.state.round);
      if (opponent && opponent.bd_json && Array.isArray(opponent.bd_json)) {
        console.log('[runCombat] 抽取对手成功', { round: this.state.round, slots: opponent.bd_json.length, opponent: opponent.username });
        const enemyResult = this.calculateCombatSnapshots(opponent.bd_json as DeploySlot[]);
        enemySnaps = enemyResult.snapshots;
        enemyOnHitEffects = enemyResult.onHitEffects;
      } else {
        console.log('[runCombat] 池空，自动获胜', { round: this.state.round });
      }
    } catch (e) { console.error('[runCombat] 抽取对手失败', e); }

    // 3. 无对手 → 自动获胜
    if (!enemySnaps || enemySnaps.length === 0) {
      const goldReward = 10 + this.state.round * 5 + this.state.deploySlots.length * 2;
      for (const slot of this.state.deploySlots) {
        const hasGrowth = this.hasGrowthAffix(slot.children) ||
          (slot.entity.children && this.hasGrowthAffix(slot.entity.children));
        if (hasGrowth) {
          const cur = this.state.growthStacks[slot.entity.instanceId] || 0;
          if (cur < 10) this.state.growthStacks[slot.entity.instanceId] = cur + 1;
        }
      }
      this.state.gold += goldReward;
      this.notify();
      onEnd(true, goldReward);
      return { win: true, enemies: [], goldReward };
    }

    // 4. 正常战斗
    const playerUnits = this.buildCombatRuntime(snapshots);
    const enemyUnits = this.buildCombatRuntime(enemySnaps);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    // 初始回调
    onEvent({
      time: 0, actorName: '', weaponName: '',
      targetName: '战斗开始', damage: 0,
      targetHpAfter: 0, targetMaxHp: 0, effects: [],
    });

    await new Promise(r => setTimeout(r, 300)); // 让 UI 先渲染

    try {
      const result = await this._runBattleCore(playerUnits, enemyUnits, playerOnHitEffects, enemyOnHitEffects, onEvent);

      const goldReward = result.win ? (10 + this.state.round * 5 + this.state.deploySlots.length * 2) : 0;

      if (result.win) {
        for (const slot of this.state.deploySlots) {
          const hasGrowth = this.hasGrowthAffix(slot.children) ||
            (slot.entity.children && this.hasGrowthAffix(slot.entity.children));
          if (hasGrowth) {
            const cur = this.state.growthStacks[slot.entity.instanceId] || 0;
            if (cur < 10) this.state.growthStacks[slot.entity.instanceId] = cur + 1;
          }
        }
        this.state.gold += goldReward;
      }

      this.notify();
      onEnd(result.win, goldReward);
      return { win: result.win, enemies: enemyUnits, goldReward };
    } finally {
      this.combatPlayerUnits = null;
      this.combatEnemyUnits = null;
    }
  }

  /** 模拟对战：接收外部双方 BD → 运行引擎 → 通知结果。
   *  BD 来源：外部传入 playerSlots / enemySlots。无金币、无生长、无存档。 */
  async runSimCombat(
    playerSlots: DeploySlot[],
    enemySlots: DeploySlot[],
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean) => void,
    isPaused?: () => boolean,
    isCancelled?: () => boolean,
  ) {
    const { snapshots: playerSnaps, onHitEffects: playerOnHit } = this.calculateCombatSnapshots(playerSlots);
    const { snapshots: enemySnaps, onHitEffects: enemyOnHit } = this.calculateCombatSnapshots(enemySlots);

    const playerUnits = this.buildCombatRuntime(playerSnaps);
    const enemyUnits = this.buildCombatRuntime(enemySnaps);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    // 初始回调
    onEvent({
      time: 0, actorName: '', weaponName: '',
      targetName: '战斗开始', damage: 0,
      targetHpAfter: 0, targetMaxHp: 0, effects: [],
    });

    await new Promise(r => setTimeout(r, 300));

    try {
      const result = await this._runBattleCore(playerUnits, enemyUnits, playerOnHit, enemyOnHit, onEvent, isPaused, isCancelled);
      onEnd(result.win);
    } finally {
      this.combatPlayerUnits = null;
      this.combatEnemyUnits = null;
    }
  }

  // ---- 存档（单存档，无槽位） ----
  toSaveData(): any {
    return {
      gold: this.state.gold, round: this.state.round,
      phase: this.state.phase,
      warehouse: this.state.warehouse, deploySlots: this.state.deploySlots,
      itemPool: this.state.itemPool, seed: this.state.seed,
      growthStacks: this.state.growthStacks, savedAt: new Date().toISOString(),
    };
  }

  loadSaveData(data: any) {
    this.state.gold = data.gold ?? 90; this.state.round = data.round ?? 1;
    this.state.phase = data.phase ?? 1;
    this.state.warehouse = data.warehouse ?? []; this.state.deploySlots = data.deploySlots ?? [];
    this.state.itemPool = data.itemPool ?? []; this.state.seed = data.seed ?? Date.now();
    this.state.growthStacks = data.growthStacks ?? {}; this.state.currentEvents = [];
    this.state.visitedEventMerchants = data.visitedEventMerchants ?? [];
    if (this.state.phase === 1) this.generateEvents();
    this.notify();
  }

  async autoSave() {
    try { await savesApi.put(this.toSaveData()); } catch (e) { console.warn('自动存档失败'); }
  }

  async manualSave() {
    await savesApi.put(this.toSaveData());
  }

  async hasSave(): Promise<boolean> {
    try { const d = await savesApi.list(); return d.save !== null; } catch { return false; }
  }

  async loadLatestSave(): Promise<boolean> {
    try {
      const d = await savesApi.list();
      if (!d.save) return false;
      this.loadSaveData(JSON.parse(d.save.data_json));
      return true;
    } catch { return false; }
  }
}
