// ============================================================
// 游戏引擎 — 状态管理、单存档、敌方BD、分步战斗（v3 统一实体模型）
// ============================================================

import {
  EntityDef, ItemInstance, DeploySlot, DefaultChildSpec,
  getEntityDef, getAffixDef, isStarter, genId,
  getEffectiveEntitySlots, countUsedSlots,
  findInTree, removeFromTreeChildren,
  ENTITY_DEFS, AFFIX_DEFS, getEntityCategory,
  getEffectiveValue,
} from './data';
import { saves as savesApi } from '../api/client';

export type GamePhase = 1 | 2;

// ---- 战斗单位快照（v3：启动端不自带攻击，武器独立触发） ----

export interface CombatUnitSnapshot {
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  totalRegen: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
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
  }[];
}

// ---- 战斗运行时（内部使用，时间线驱动） ----

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
}

export interface CombatUnitRuntime {
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
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
  combatSpeed = 1; // 0.5 | 1 | 2
  combatRunning = false;
  combatPaused = false;
  combatPlayerUnits: CombatUnitRuntime[] | null = null;
  combatEnemyUnits: CombatUnitRuntime[] | null = null;
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
  private collectFromChildren(
    children: ItemInstance[],
    growthStack: number,
  ): {
    totalRegen: number; totalHpBonus: number;
    totalLoad: number; passiveDamageBonus: number;
    weapons: CombatUnitSnapshot['activeWeapons'];
  } {
    let totalRegen = 0, totalHpBonus = 0, totalLoad = 0, passiveDamageBonus = 0;
    const weapons: CombatUnitSnapshot['activeWeapons'] = [];

    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;

        // v5: 使用 getEffectiveValue 读取，支持 ItemInstance.overrides
        totalRegen += Number(getEffectiveValue(child, 'regenBonus') ?? 0);
        totalHpBonus += Number(getEffectiveValue(child, 'hpBonus') ?? 0);
        totalLoad += Number(getEffectiveValue(child, 'weight') ?? 0);

        const isActive = getEffectiveValue(child, 'isActive') ?? cdef.isActive;
        if (isActive) {
          const wDamage = Number(getEffectiveValue(child, 'damage') ?? 0);
          let weaponDamage = wDamage + passiveDamageBonus + growthStack;
          weapons.push({
            name: String(getEffectiveValue(child, 'name') ?? cdef.name),
            actionTime: Number(getEffectiveValue(child, 'actionTime') ?? 0),
            damage: weaponDamage,
            staminaCost: Number(getEffectiveValue(child, 'staminaCost') ?? 0),
            targetType: String((getEffectiveValue(child, 'targetType') ?? cdef.targetType) || '近战'),
            targetOrder: String((getEffectiveValue(child, 'targetOrder') ?? cdef.targetOrder) || '从上往下'),
            priorityTarget: (getEffectiveValue(child, 'priorityTarget') ?? cdef.priorityTarget) as number | null,
            targetFaction: String((getEffectiveValue(child, 'targetFaction') ?? cdef.targetFaction) || '敌人'),
          });
        } else {
          // 被动装备 → 累加伤害到被动池
          passiveDamageBonus += Number(getEffectiveValue(child, 'damage') ?? 0);
          // 递归处理容器内的嵌套子项
          if (child.children && child.children.length > 0) {
            const nested = this.collectFromChildren(child.children, growthStack);
            totalRegen += nested.totalRegen;
            totalHpBonus += nested.totalHpBonus;
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
    return { totalRegen, totalHpBonus, totalLoad, passiveDamageBonus, weapons };
  }

  /** 从 DeploySlot 构建 CombatUnitSnapshot（v4：递归嵌套）。可传入自定义 slots 用于模拟对战。 */
  calculateCombatSnapshots(slots?: DeploySlot[]): CombatUnitSnapshot[] {
    const deploySlots = slots ?? this.state.deploySlots;
    const units: CombatUnitSnapshot[] = [];
    for (const slot of deploySlots) {
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;

      const growthStack = this.state.growthStacks[slot.entity.instanceId] || 0;
      // 合并 entity 自身的默认子实体 + slot 的用户挂载物品
      const allChildren = [...(slot.entity.children || []), ...slot.children];
      const collected = isStarter(edef)
        ? this.collectFromChildren(allChildren, growthStack)
        : { totalRegen: 0, totalHpBonus: 0, totalLoad: 0, passiveDamageBonus: 0, weapons: [] };

      // strength 词条加成（仅 starter）
      let extraDmg = 0;
      if (isStarter(edef)) {
        for (const c of slot.children) {
          if (c.type === 'affix') {
            const adef = getAffixDef(c.defId);
            if (adef?.id === 'strength') extraDmg += adef.value;
          }
        }
        for (const w of collected.weapons) {
          w.damage += collected.passiveDamageBonus - extraDmg;
        }
      }

      const hp = edef.hp + collected.totalHpBonus;
      const isOverloaded = collected.totalLoad > edef.maxLoad;

      units.push({
        entityId: edef.id,
        entityName: edef.name + (isStarter(edef) ? '' : '(木桩)'),
        totalHp: hp,
        currentHp: hp,
        totalRegen: edef.staminaRegen + collected.totalRegen,
        maxStamina: edef.maxStamina,
        currentStamina: edef.maxStamina,
        staminaRegen: edef.staminaRegen,
        currentLoad: collected.totalLoad,
        maxLoad: edef.maxLoad,
        isOverloaded,
        activeWeapons: collected.weapons,
      });
    }
    return units;
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
        weapons.push({ ...wt, damage: wdmg > 0 ? wdmg : wt.damage });
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
        });
      }

      units.push({
        entityId: `enemy_${i}`,
        entityName: `${t.name} Lv${r}`,
        totalHp: hp,
        currentHp: hp,
        totalRegen: t.staminaRegen,
        maxStamina: t.maxStamina,
        currentStamina: t.maxStamina,
        staminaRegen: t.staminaRegen,
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
      entityId: u.entityId,
      entityName: u.entityName,
      totalHp: u.totalHp,
      currentHp: u.currentHp,
      maxStamina: u.maxStamina,
      currentStamina: u.currentStamina,
      staminaRegen: u.totalRegen, // 使用包含装备加成的总回复
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

  /** 时间线驱动战斗引擎（内部核心，不含状态管理） */
  private async _runBattleCore(
    playerUnits: CombatUnitRuntime[],
    enemyUnits: CombatUnitRuntime[],
    onEvent: (evt: CombatEvent) => void,
    speed: number | (() => number),
    isPaused?: () => boolean,
  ): Promise<{ win: boolean }> {
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    let simTime = 0;
    const MAX_SIM_TIME = 120000; // 2 分钟模拟时间上限

    while (
      playerUnits.some(u => u.currentHp > 0) &&
      enemyUnits.some(e => e.currentHp > 0) &&
      simTime < MAX_SIM_TIME
    ) {
      // 暂停检查
      while (isPaused?.()) {
        await delay(50);
      }

      // 找到所有武器中最小的 remainingTime
      let dt = Infinity;
      const allWeapons: { unit: CombatUnitRuntime; weapon: CombatWeaponRuntime; isPlayer: boolean }[] = [];

      for (const u of playerUnits) {
        if (u.currentHp <= 0) continue;
        for (const w of u.weapons) {
          if (w.remainingTime < dt) dt = w.remainingTime;
          allWeapons.push({ unit: u, weapon: w, isPlayer: true });
        }
      }
      for (const e of enemyUnits) {
        if (e.currentHp <= 0) continue;
        for (const w of e.weapons) {
          if (w.remainingTime < dt) dt = w.remainingTime;
          allWeapons.push({ unit: e, weapon: w, isPlayer: false });
        }
      }

      if (dt === Infinity || dt <= 0) dt = 100; // fallback

      // 实际等待（speed 支持 getter 函数以允许运行时变速）
      const currentSpeed = typeof speed === 'function' ? speed() : speed;
      await delay(Math.max(dt / currentSpeed, 50));

      simTime += dt;

      // 推进时间 + 耐力回复
      for (const u of playerUnits) {
        if (u.currentHp <= 0) continue;
        u.currentStamina = Math.min(u.currentStamina + u.staminaRegen * dt / 1000, u.maxStamina);
        for (const w of u.weapons) w.remainingTime -= dt;
      }
      for (const e of enemyUnits) {
        if (e.currentHp <= 0) continue;
        e.currentStamina = Math.min(e.currentStamina + e.staminaRegen * dt / 1000, e.maxStamina);
        for (const w of e.weapons) w.remainingTime -= dt;
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
        unit.currentStamina -= effectiveCost;

        // 选择目标（根据 targetFaction 决定从哪方选）
        const target = this.selectTarget(weapon, playerUnits, enemyUnits, isPlayer);
        if (!target) continue;

        // 计算伤害（dmg 可为负值=恢复HP）
        const dmg = damage;
        target.currentHp -= dmg;
        // HP 上限保护（耐力系统已有此保护，HP 之前遗漏）
        target.currentHp = Math.min(target.currentHp, target.totalHp);

        // 重置倒计时
        weapon.remainingTime = weapon.actionTime;

        // 发射事件
        const effects: string[] = [];
        if (Math.abs(dmg) >= target.totalHp * 0.3) effects.push(dmg > 0 ? '重击' : '大回复');

        onEvent({
          time: Math.round(simTime),
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
            time: Math.round(simTime),
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

      // 更新战斗状态供 UI 轮询
      this.combatPlayerUnits = playerUnits;
      this.combatEnemyUnits = enemyUnits;
    }

    const win = playerUnits.some(u => u.currentHp > 0);
    return { win };
  }

  /** 时间线驱动战斗引擎（正式游戏） */
  async runCombat(
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean, gold: number) => void,
    speed: number,
  ) {
    const snapshots = this.calculateCombatSnapshots();
    const enemySnaps = this.generateEnemyBD();

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

    const result = await this._runBattleCore(playerUnits, enemyUnits, onEvent, speed);

    const goldReward = result.win ? (10 + this.state.round * 5 + this.state.deploySlots.length * 2) : 0;

    if (result.win) {
      for (const slot of this.state.deploySlots) {
        // 递归检查 growth 词条
        const hasGrowth = this.hasGrowthAffix(slot.children) ||
          (slot.entity.children && this.hasGrowthAffix(slot.entity.children));
        if (hasGrowth) {
          const cur = this.state.growthStacks[slot.entity.instanceId] || 0;
          if (cur < 10) this.state.growthStacks[slot.entity.instanceId] = cur + 1;
        }
      }
      this.state.gold += goldReward;
    }

    this.combatPlayerUnits = null;
    this.combatEnemyUnits = null;
    this.notify();
    onEnd(result.win, goldReward);
    return { win: result.win, enemies: enemyUnits, goldReward };
  }

  /** 模拟对战：使用自定义双方 BD 运行战斗，无金币/生长/存档 */
  async runSimCombat(
    playerSlots: DeploySlot[],
    enemySlots: DeploySlot[],
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean) => void,
    speed: number | (() => number),
    isPaused?: () => boolean,
  ) {
    const playerSnaps = this.calculateCombatSnapshots(playerSlots);
    const enemySnaps = this.calculateCombatSnapshots(enemySlots);

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

    const result = await this._runBattleCore(playerUnits, enemyUnits, onEvent, speed, isPaused);

    this.combatPlayerUnits = null;
    this.combatEnemyUnits = null;
    onEnd(result.win);
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
