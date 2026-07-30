// ============================================================
// 游戏引擎 — 状态管理、单存档、敌方BD、分步战斗（v3 统一实体模型）
// ============================================================

import {
  EntityDef, ItemInstance, DeploySlot, DefaultChildSpec,
  getEntityDef, getAffixDef, isStarter, genId, getDefaultStarterId,
  getEffectiveEntitySlots, countUsedSlots,
  findInTree, removeFromTreeChildren,
  ENTITY_DEFS, AFFIX_DEFS, getEntityCategory,
  getEffectiveValue, OnHitEffect, TargetCondition, TargetingModifier,
} from './data';
import { data as dataApi, saves as savesApi } from '../api/client';
import {
  runBattleWithOptionalWorker,
  buildCombatRuntime,
  type CombatUnitSnapshot, type CombatUnitRuntime, type CombatEvent,
  type PlaybackSpeed,
} from './battle';

export type {
  CombatUnitSnapshot, CombatUnitRuntime, CombatEvent,
  CombatWeaponRuntime, OnHitContext, PlaybackSpeed,
} from './battle';

/** 兼容旧存档：1=探险 2=战斗；正式语义以 round 奇偶为准 */
export type GamePhase = 1 | 2;

/** 默认最大设计回合（可配置） */
export const MAX_ROUND = 10;

/** 本局一场战斗归档记录 */
export interface BattleRecord {
  round: number;
  result: 'win' | 'loss' | 'auto_win';
  rewardGold: number;
  playerBd: DeploySlot[];
  enemyBd: DeploySlot[] | null;
  opponentName?: string;
  combatSeed?: number;
  durationMs?: number;
  endedBy?: string;
  log: CombatEvent[];
}

// ---- 游戏状态 ----

export interface GameState {
  gold: number;
  /** 设计回合 1..MAX_ROUND：奇数=探险，偶数=战斗 */
  round: number;
  /** 与 round 奇偶同步，便于旧 UI/存档 */
  phase: GamePhase;
  warehouse: ItemInstance[];
  deploySlots: DeploySlot[];
  itemPool: string[];
  seed: number;
  currentEvents: string[];
  visitedEventMerchants: string[];
  /** @deprecated 设计已取消成长，仅兼容旧存档 */
  growthStacks: Record<string, number>;
  quickWarehouseCollapsed: boolean;
  /** 本局已完成的战斗回顾 */
  battles: BattleRecord[];
  maxRound: number;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export class GameEngine {
  state!: GameState;
  username = '';
  /** 关联历史归档 id；首战 upsert 后写入存档 */
  historyRunId: number | null = null;

  onStateChange?: () => void;
  onToast?: (msg: string) => void;
  rightPanel: string | null = null;

  // 战斗相关
  combatRunning = false;
  combatPaused = false;
  combatPlayerUnits: CombatUnitRuntime[] | null = null;
  combatEnemyUnits: CombatUnitRuntime[] | null = null;
  combatTime: number = 0;
  /** Playback 倍速（1/2/4/max）；仅影响播放墙钟，不影响演算结果 */
  combatSpeed: PlaybackSpeed = 1;
  onCombatEvent?: (event: CombatEvent) => void;
  onCombatEnd?: (win: boolean, goldReward: number) => void;

  constructor() { this.resetState(); }

  resetState() {
    this.state = {
      gold: 90, round: 1, phase: 1,
      warehouse: [], deploySlots: [], itemPool: [], seed: Date.now(),
      currentEvents: [], visitedEventMerchants: [], growthStacks: {},
      quickWarehouseCollapsed: false, battles: [], maxRound: MAX_ROUND,
    };
    this.rebuildItemPool();
    // 开局 BD / 仓库皆空，不自动部署默认 starter
    this.rightPanel = null;
    this.historyRunId = null;
    // 进入回合 1 探险：发放探险金 + 生成事件
    this.grantExploreGold();
    this.generateEvents();
    this.notify();
  }

  /** 是否探险阶段（奇数回合） */
  isExplore(): boolean { return this.state.round % 2 === 1; }
  /** 是否战斗阶段（偶数回合） */
  isBattlePhase(): boolean { return this.state.round % 2 === 0; }
  syncPhaseFromRound() { this.state.phase = this.isExplore() ? 1 : 2; }

  /** 探险发金：floor((round+1)/2)×10 */
  grantExploreGold(): number {
    const amount = Math.floor((this.state.round + 1) / 2) * 10;
    this.state.gold += amount;
    return amount;
  }

  /** 战斗获胜金：floor((round+1)/2)×5 */
  getBattleWinGold(): number {
    return Math.floor((this.state.round + 1) / 2) * 5;
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

  /** 将物品移动到出场面板指定位置（支持嵌套父实体；第一层可为启动端或木桩） */
  moveToDeploy(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null): string | null {
    const def = this.getDef(item); if (!def) return '未知物品';
    if (item.type === 'entity') {
      const edef = def as EntityDef;
      const pid = parentInstanceId ?? null;

      // 启动端只能放在第一层
      if (isStarter(edef) && pid !== null) return '启动端只能放在第一层级';

      if (pid === null) {
        // 第一层：启动端或木桩，只校验槽位
        const maxSlots = this.getFirstLayerSlots();
        let usedSlots = 0;
        for (const s of this.state.deploySlots) {
          if (s.entity.instanceId === item.instanceId) continue;
          const d = getEntityDef(s.entity.defId);
          if (d) usedSlots += d.slotCost;
        }
        if (usedSlots + edef.slotCost > maxSlots) {
          return `第一层槽位不足(剩${maxSlots - usedSlots},需${edef.slotCost})`;
        }
        this.removeFromWarehouse(item.instanceId);
        this.removeFromDeploy(item.instanceId);
        this.state.deploySlots.push({ entity: item, children: [] });
        this.notify();
        return null;
      }

      // 嵌套：放入某实体子树（启动端已在上方拦截）
      if (targetSlotIdx === undefined) return '装备需放入实体的槽位';
      const err = this.canEquipToSlot(targetSlotIdx, pid, edef); if (err) return err;
      this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
      const parentEntity = this.findParentEntity(pid, targetSlotIdx);
      if (!parentEntity) return '父实体不存在';
      if (!parentEntity.children) parentEntity.children = [];
      parentEntity.children.push(item);
      this.notify();
      return null;
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
  buyItem(item: ItemInstance, priceOverride?: number): string | null {
    const def = this.getDef(item);
    const price = priceOverride ?? (def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price; this.addToWarehouse(item); return null;
  }
  buyAndEquip(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null, priceOverride?: number): string | null {
    const def = this.getDef(item);
    const price = priceOverride ?? (def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    // 先装备：失败则不扣金（避免槽位不足吞金后 HUD 与引擎不同步）
    const err = this.moveToDeploy(item, targetSlotIdx, parentInstanceId);
    if (err) return err;
    this.state.gold -= price;
    this.notify();
    return null;
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
    return `回合${this.state.round} ${this.isExplore() ? '探险' : '战斗'}阶段`;
  }
  getMerchantValueCap(): number { return this.state.round * 10; }
  /** 第一层槽位 = floor((round+1)/2) */
  getFirstLayerSlots(): number { return Math.floor((this.state.round + 1) / 2); }

  /**
   * 从探险进入战斗回合（round 奇数 → 偶数）。
   * 不开战、不发奖；由 UI 再调 prepareOfficialBattle。
   */
  enterBattleRound() {
    if (!this.isExplore()) return;
    this.sanitizeMissingEntityDefs();
    this.state.round += 1;
    this.syncPhaseFromRound();
    this.notify();
  }

  /**
   * 网络异常时从战斗回合退回探险（round 偶数 → 奇数），便于重试开战。
   */
  rollbackBattleToExplore() {
    if (!this.isBattlePhase()) return;
    this.state.round -= 1;
    this.syncPhaseFromRound();
    this.notify();
  }

  /**
   * 战斗结束态点「继续」：
   * - 已达 maxRound → 返回 'settlement'
   * - 否则进入下一探险回合并发金、生成事件、自动存档
   */
  continueAfterBattle(): 'explore' | 'settlement' {
    if (this.state.round >= this.state.maxRound) {
      return 'settlement';
    }
    this.state.round += 1;
    this.syncPhaseFromRound();
    this.state.visitedEventMerchants = [];
    this.generateEvents();
    this.grantExploreGold();
    this.autoSave();
    this.notify();
    return 'explore';
  }

  /** @deprecated 使用 enterBattleRound / continueAfterBattle */
  nextPhase() {
    if (this.isExplore()) this.enterBattleRound();
    else this.continueAfterBattle();
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
    totalLoad: number; totalLoadBonus: number; passiveDamageBonus: number;
    weapons: CombatUnitSnapshot['activeWeapons'];
  } {
    let totalStaminaRegenerationBonus = 0, totalStaminaBonus = 0, totalHpBonus = 0, totalHpRegenerationBonus = 0;
    let totalLoad = 0, totalLoadBonus = 0, passiveDamageBonus = 0;
    const weapons: CombatUnitSnapshot['activeWeapons'] = [];

    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;

        // 重量始终计入；被动加成仅 hasPassiveBonuses=true 时累加
        totalLoad += Number(getEffectiveValue(child, 'weight') ?? 0);
        const childHasPB = getEffectiveValue(child, 'hasPassiveBonuses') ?? cdef.hasPassiveBonuses;
        if (childHasPB) {
          totalStaminaRegenerationBonus += Number(getEffectiveValue(child, 'staminaRegenerationBonus') ?? 0);
          totalStaminaBonus += Number(getEffectiveValue(child, 'staminaBonus') ?? 0);
          totalHpBonus += Number(getEffectiveValue(child, 'hpBonus') ?? 0);
          totalHpRegenerationBonus += Number(getEffectiveValue(child, 'hpRegenerationBonus') ?? 0);
          totalLoadBonus += Number(getEffectiveValue(child, 'loadBonus') ?? 0);
        }

        const isActive = getEffectiveValue(child, 'isActive') ?? cdef.isActive;
        if (isActive) {
          const wDamage = Number(getEffectiveValue(child, 'damage') ?? 0);
          const weaponDamage = wDamage + growthStack;
          // ★ v7: 收集本实体直属 affix 子项中的 targeting_modifier（per-entity 生效）
          const entityTargetingMods = this._collectEntityTargetingMods(child.children);
          // 被动伤害加成统一在 calculateCombatSnapshots 阶段应用，避免双重累加
          weapons.push({
            name: String(getEffectiveValue(child, 'name') ?? cdef.name),
            actionTime: Number(getEffectiveValue(child, 'actionTime') ?? 0),
            damage: weaponDamage,
            staminaCost: Number(getEffectiveValue(child, 'staminaCost') ?? 0),
            targetType: String((getEffectiveValue(child, 'targetType') ?? cdef.targetType) || '近战'),
            targetOrder: this._mergeTargetingField('targetOrder', entityTargetingMods, child, cdef, '从上往下'),
            priorityTarget: this._mergeTargetingField('priorityTarget', entityTargetingMods, child, cdef, null),
            targetFaction: this._mergeTargetingField('targetFaction', entityTargetingMods, child, cdef, '敌人'),
            targetCondition: this._mergeTargetCondition(entityTargetingMods, child, cdef),
            ownerInstanceId: child.instanceId,
          });
        } else if (childHasPB) {
          // isActive=false 且有被动 → 累加 damageBonus 到被动池
          passiveDamageBonus += Number(getEffectiveValue(child, 'damageBonus') ?? 0);
        }
        // 递归处理嵌套子项（isActive 和 !isActive 实体都需要：武器上的词条、嵌套实体等）
        if (child.children && child.children.length > 0) {
          const nested = this.collectFromChildren(child.children, growthStack);
          totalStaminaRegenerationBonus += nested.totalStaminaRegenerationBonus;
          totalStaminaBonus += nested.totalStaminaBonus;
          totalHpBonus += nested.totalHpBonus;
          totalHpRegenerationBonus += nested.totalHpRegenerationBonus;
          totalLoad += nested.totalLoad;
          totalLoadBonus += nested.totalLoadBonus;
          passiveDamageBonus += nested.passiveDamageBonus;
          for (const w of nested.weapons) weapons.push(w);
        }
      }
      if (child.type === 'affix') {
        const adef = getAffixDef(child.defId);
        if (adef) {
          // v7: 快速跳过无被动加成的词条（避免逐字段检查零值，提升性能）
          if (adef.hasPassiveBonuses) {
            totalStaminaRegenerationBonus += adef.staminaRegenerationBonus ?? 0;
            totalStaminaBonus += adef.staminaBonus ?? 0;
            totalHpBonus += adef.hpBonus ?? 0;
            totalHpRegenerationBonus += adef.hpRegenerationBonus ?? 0;
            totalLoadBonus += adef.loadBonus ?? 0;
            passiveDamageBonus += adef.damageBonus ?? 0;
          }
        }
      }
    }
    return { totalStaminaRegenerationBonus, totalStaminaBonus, totalHpBonus, totalHpRegenerationBonus, totalLoad, totalLoadBonus, passiveDamageBonus, weapons };
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
        : { totalStaminaRegenerationBonus: 0, totalStaminaBonus: 0, totalHpBonus: 0, totalHpRegenerationBonus: 0, totalLoad: 0, totalLoadBonus: 0, passiveDamageBonus: 0, weapons: [] };

      // ★ 启动端自身的被动加成也对自己生效（受 hasPassiveBonuses 约束）
      if (isStarter(edef) && edef.hasPassiveBonuses) {
        collected.totalStaminaRegenerationBonus += edef.staminaRegenerationBonus;
        collected.totalStaminaBonus += edef.staminaBonus;
        collected.totalHpBonus += edef.hpBonus;
        collected.totalHpRegenerationBonus += edef.hpRegenerationBonus;
        collected.totalLoadBonus += edef.loadBonus ?? 0;
        collected.passiveDamageBonus += Number(getEffectiveValue(slot.entity, 'damageBonus') ?? edef.damageBonus ?? 0);
      }

      // ★ 启动端自身如果是主动实体，也加入武器列表
      if (isStarter(edef)) {
        const selfIsActive = getEffectiveValue(slot.entity, 'isActive') ?? edef.isActive;
        if (selfIsActive) {
          // v7: 收集启动端直属 affix 子项中的 targeting_modifier（per-entity 生效）
          const starterTargetingMods = this._collectEntityTargetingMods(allChildren);
          collected.weapons.unshift({
            name: edef.name,
            actionTime: Number(getEffectiveValue(slot.entity, 'actionTime') ?? 0),
            damage: Number(getEffectiveValue(slot.entity, 'damage') ?? 0) + growthStack,
            staminaCost: Number(getEffectiveValue(slot.entity, 'staminaCost') ?? 0),
            targetType: String((getEffectiveValue(slot.entity, 'targetType') ?? edef.targetType) || '近战'),
            targetOrder: this._mergeTargetingField('targetOrder', starterTargetingMods, slot.entity, edef, '从上往下'),
            priorityTarget: this._mergeTargetingField('priorityTarget', starterTargetingMods, slot.entity, edef, null),
            targetFaction: this._mergeTargetingField('targetFaction', starterTargetingMods, slot.entity, edef, '敌人'),
            targetCondition: this._mergeTargetCondition(starterTargetingMods, slot.entity, edef),
            ownerInstanceId: slot.entity.instanceId,
          });
        }
      }

      // onHitEffects 收集
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

        const netPassive = collected.passiveDamageBonus;
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
      const effectiveMaxLoad = edef.maxLoad + collected.totalLoadBonus;
      const isOverloaded = collected.totalLoad > effectiveMaxLoad;

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
        maxLoad: effectiveMaxLoad,
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
    return buildCombatRuntime(units);
  }

  /** 合并单个 targeting 字段（v7）：词条 modifiers（从前到后依次覆写）> entity override > entityDef */
  private _mergeTargetingField<T>(
    field: keyof TargetingModifier,
    modifiers: TargetingModifier[],
    item: ItemInstance,
    def: EntityDef,
    defaultValue: T,
  ): T {
    let result: T | undefined = undefined;
    // ★ children 数组顺序：从前到后，后面的覆盖前面的
    for (const mod of modifiers) {
      const val = (mod as any)[field];
      if (val !== undefined) result = val as T;
    }
    if (result !== undefined) return result;
    const ov = (item.overrides as any)?.[field];
    if (ov !== undefined) return ov as T;
    return (def as any)[field] ?? defaultValue;
  }

  /** 合并 targetCondition（v7）：词条 modifiers > entity override > entityDef */
  private _mergeTargetCondition(
    modifiers: TargetingModifier[],
    item: ItemInstance,
    def: EntityDef,
  ): TargetCondition | undefined {
    let sortBy: any = undefined;
    let filterBy: any = undefined;
    // ★ children 数组顺序：从前到后
    for (const mod of modifiers) {
      if (mod.sortBy !== undefined) sortBy = mod.sortBy;
      if (mod.filterBy !== undefined) filterBy = mod.filterBy;
    }
    // entity override
    if (sortBy === undefined) {
      sortBy = (item.overrides as any)?.targetCondition?.sortBy ?? def.targetCondition?.sortBy;
    }
    if (filterBy === undefined) {
      filterBy = (item.overrides as any)?.targetCondition?.filterBy ?? def.targetCondition?.filterBy;
    }
    if (sortBy || filterBy) {
      return { sortBy: sortBy ?? undefined, filterBy: filterBy ?? undefined, fallback: 'targetOrder' };
    }
    return undefined;
  }

  /** 收集实体直属 affix 子项中的 targeting_modifier（v7） */
  private _collectEntityTargetingMods(children: ItemInstance[] | undefined): TargetingModifier[] {
    const mods: TargetingModifier[] = [];
    if (!children) return mods;
    for (const sub of children) {
      if (sub.type === 'affix') {
        const adef = getAffixDef(sub.defId);
        if (adef?.targetingModifier) mods.push(adef.targetingModifier);
      }
    }
    return mods;
  }

  /** 递归检查实体树中是否有 growth 词条 */
  private hasGrowthAffix(children: ItemInstance[]): boolean {
    for (const c of children) {
      if (c.type === 'affix' && c.defId === 'growth') return true;
      if (c.children && this.hasGrowthAffix(c.children)) return true;
    }
    return false;
  }

  /** 通过 BattleSimulator + Playback（max 时可选 Worker）驱动战斗 */
  private async _playWithSimulator(
    playerUnits: CombatUnitRuntime[],
    enemyUnits: CombatUnitRuntime[],
    playerOnHitEffects: Map<string, OnHitEffect[]>,
    enemyOnHitEffects: Map<string, OnHitEffect[]>,
    onEvent: (evt: CombatEvent) => void,
    isPaused?: () => boolean,
    isCancelled?: () => boolean,
    speed?: PlaybackSpeed | (() => PlaybackSpeed),
  ): Promise<{ win: boolean }> {
    this.combatTime = 0;
    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    return runBattleWithOptionalWorker({
      playerUnits,
      enemyUnits,
      playerOnHitEffects,
      enemyOnHitEffects,
      onEvent,
      speed: speed ?? (() => this.combatSpeed),
      onTick: (combatTime, player, enemy) => {
        this.combatTime = combatTime;
        this.combatPlayerUnits = player;
        this.combatEnemyUnits = enemy;
      },
      isPaused,
      isCancelled,
    });
  }

  /** 应用胜利结算：仅满额战斗金（无 growth） */
  private applyCombatVictoryRewards(): number {
    const goldReward = this.getBattleWinGold();
    this.state.gold += goldReward;
    this.notify();
    return goldReward;
  }

  /** 记录本场战斗并自动存档（结束态） */
  recordBattle(rec: BattleRecord) {
    this.state.battles.push(rec);
    this.autoSave();
  }

  /**
   * 正式战准备：上传己方 BD + 从对战池抽取敌方。
   * networkError=true 时 UI 必须留在探险、不可当自动胜。
   */
  async prepareOfficialBattle(): Promise<{
    playerSlots: DeploySlot[];
    enemySlots: DeploySlot[] | null;
    autoWin: boolean;
    networkError: boolean;
    opponentName?: string;
    errorMessage?: string;
  }> {
    const playerSlots = JSON.parse(JSON.stringify(this.state.deploySlots)) as DeploySlot[];

    try {
      const r = await dataApi.uploadBD(this.state.round, playerSlots);
      console.log('[prepareOfficialBattle] 上传 BD 成功', { round: this.state.round, id: r.id, slots: playerSlots.length });
    } catch (e) {
      console.error('[prepareOfficialBattle] 上传 BD 失败', e);
      return {
        playerSlots, enemySlots: null, autoWin: false, networkError: true,
        errorMessage: (e as Error)?.message || '上传 BD 失败，请检查网络后重试',
      };
    }

    try {
      const { opponent } = await dataApi.getBattlePool(this.state.round);
      if (opponent && opponent.bd_json && Array.isArray(opponent.bd_json) && opponent.bd_json.length > 0) {
        return {
          playerSlots,
          enemySlots: opponent.bd_json as DeploySlot[],
          autoWin: false,
          networkError: false,
          opponentName: opponent.username,
        };
      }
      return { playerSlots, enemySlots: null, autoWin: true, networkError: false };
    } catch (e) {
      console.error('[prepareOfficialBattle] 抽取对手失败', e);
      return {
        playerSlots, enemySlots: null, autoWin: false, networkError: true,
        errorMessage: (e as Error)?.message || '匹配失败，请检查网络后重试',
      };
    }
  }

  /** 空池自动获胜结算 */
  settleOfficialAutoWin(
    onEnd: (win: boolean, gold: number) => void,
    log: CombatEvent[] = [],
  ): { win: true; goldReward: number } {
    const goldReward = this.applyCombatVictoryRewards();
    this.recordBattle({
      round: this.state.round,
      result: 'auto_win',
      rewardGold: goldReward,
      playerBd: JSON.parse(JSON.stringify(this.state.deploySlots)),
      enemyBd: null,
      log: log.length ? log : [{
        time: 0, actorName: '', weaponName: '', targetName: '玩家胜利',
        damage: 0, targetHpAfter: 0, targetMaxHp: 0, effects: ['空池自动获胜'],
      }],
      endedBy: 'empty_pool',
    });
    onEnd(true, goldReward);
    return { win: true, goldReward };
  }

  /**
   * 用已解析的双方 BD 开战（不再抽池）。
   * 正式战匹配完成后、或兼容 runCombat 内部使用。
   */
  async runCombatWithSides(
    playerSlots: DeploySlot[],
    enemySlots: DeploySlot[],
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean, gold: number) => void,
    isPaused?: () => boolean,
    isCancelled?: () => boolean,
    speed?: PlaybackSpeed | (() => PlaybackSpeed),
  ) {
    const { snapshots, onHitEffects: playerOnHitEffects } = this.calculateCombatSnapshots(playerSlots);
    const { snapshots: enemySnaps, onHitEffects: enemyOnHitEffects } = this.calculateCombatSnapshots(enemySlots);

    const playerUnits = this.buildCombatRuntime(snapshots);
    const enemyUnits = this.buildCombatRuntime(enemySnaps);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    onEvent({
      time: 0, actorName: '', weaponName: '',
      targetName: '战斗开始', damage: 0,
      targetHpAfter: 0, targetMaxHp: 0, effects: [],
    });

    await new Promise(r => setTimeout(r, 300));

    try {
      const result = await this._playWithSimulator(
        playerUnits, enemyUnits, playerOnHitEffects, enemyOnHitEffects, onEvent,
        isPaused, isCancelled, speed ?? (() => this.combatSpeed),
      );

      let goldReward = 0;
      if (result.win) {
        goldReward = this.applyCombatVictoryRewards();
      } else {
        this.notify();
      }

      this.recordBattle({
        round: this.state.round,
        result: result.win ? 'win' : 'loss',
        rewardGold: goldReward,
        playerBd: JSON.parse(JSON.stringify(playerSlots)),
        enemyBd: JSON.parse(JSON.stringify(enemySlots)),
        durationMs: this.combatTime,
        log: [], // UI 侧应在调用前通过外层收集完整日志后覆盖；此处保底
        endedBy: result.win ? 'enemy_down' : 'player_down',
      });

      onEnd(result.win, goldReward);
      return { win: result.win, enemies: enemyUnits, goldReward };
    } finally {
      this.combatPlayerUnits = null;
      this.combatEnemyUnits = null;
    }
  }

  /** 正式战斗兼容入口：prepare + 自动胜或 runCombatWithSides */
  async runCombat(
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean, gold: number) => void,
    isPaused?: () => boolean,
    isCancelled?: () => boolean,
    speed?: PlaybackSpeed | (() => PlaybackSpeed),
  ) {
    const prep = await this.prepareOfficialBattle();
    if (prep.networkError) {
      throw new Error(prep.errorMessage || '网络异常');
    }
    if (prep.autoWin || !prep.enemySlots) {
      return this.settleOfficialAutoWin(onEnd);
    }
    return this.runCombatWithSides(
      prep.playerSlots, prep.enemySlots, onEvent, onEnd, isPaused, isCancelled, speed,
    );
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
    speed?: PlaybackSpeed | (() => PlaybackSpeed),
  ) {
    const { snapshots: playerSnaps, onHitEffects: playerOnHit } = this.calculateCombatSnapshots(playerSlots);
    const { snapshots: enemySnaps, onHitEffects: enemyOnHit } = this.calculateCombatSnapshots(enemySlots);

    const playerUnits = this.buildCombatRuntime(playerSnaps);
    const enemyUnits = this.buildCombatRuntime(enemySnaps);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    onEvent({
      time: 0, actorName: '', weaponName: '',
      targetName: '战斗开始', damage: 0,
      targetHpAfter: 0, targetMaxHp: 0, effects: [],
    });

    await new Promise(r => setTimeout(r, 300));

    try {
      const result = await this._playWithSimulator(
        playerUnits, enemyUnits, playerOnHit, enemyOnHit, onEvent,
        isPaused, isCancelled, speed ?? (() => this.combatSpeed),
      );
      onEnd(result.win);
    } finally {
      this.combatPlayerUnits = null;
      this.combatEnemyUnits = null;
    }
  }

  // ---- 存档（单存档，无槽位） ----
  toSaveData(): any {
    return {
      gold: this.state.gold,
      round: this.state.round,
      phase: this.state.phase,
      warehouse: this.state.warehouse,
      deploySlots: this.state.deploySlots,
      itemPool: this.state.itemPool,
      seed: this.state.seed,
      currentEvents: this.state.currentEvents,
      visitedEventMerchants: this.state.visitedEventMerchants,
      battles: this.state.battles,
      maxRound: this.state.maxRound,
      historyRunId: this.historyRunId,
      savedAt: new Date().toISOString(),
      saveVersion: 2,
    };
  }

  /** 组装历史归档 run 快照 */
  buildHistoryRunPayload(status: 'in_progress' | 'cleared'): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      status,
      maxRound: this.state.maxRound,
      gold: this.state.gold,
      seed: this.state.seed,
      battles: this.state.battles,
      updatedAt: new Date().toISOString(),
    };
    if (status === 'cleared') {
      payload.finishedAt = new Date().toISOString();
      payload.deploySlots = this.state.deploySlots;
      payload.warehouse = this.state.warehouse;
    }
    return payload;
  }

  /**
   * 首战创建 / 之后更新历史归档。无战斗记录时跳过。
   * 失败抛错由调用方决定是否 toast。
   */
  async syncHistoryRun(status: 'in_progress' | 'cleared' = 'in_progress'): Promise<void> {
    if (!this.state.battles.length) return;
    const run = this.buildHistoryRunPayload(status);
    const { history } = await import('../api/client');
    if (this.historyRunId == null) {
      const r = await history.create(run);
      this.historyRunId = r.id;
      await this.autoSave();
    } else {
      await history.update(this.historyRunId, run);
    }
  }

  loadSaveData(data: any) {
    // 旧存档：round+phase 模型 → 设计回合
    let round = data.round ?? 1;
    let phase: GamePhase = data.phase ?? 1;
    if ((data.saveVersion ?? 1) < 2 && data.phase != null) {
      round = phase === 1 ? round * 2 - 1 : round * 2;
    }
    this.state.gold = data.gold ?? 90;
    this.state.round = round;
    this.syncPhaseFromRound();
    this.state.warehouse = data.warehouse ?? [];
    this.state.deploySlots = data.deploySlots ?? [];
    this.sanitizeMissingEntityDefs();
    this.state.itemPool = data.itemPool ?? [];
    this.state.seed = data.seed ?? Date.now();
    this.state.growthStacks = data.growthStacks ?? {};
    this.state.visitedEventMerchants = data.visitedEventMerchants ?? [];
    this.state.battles = data.battles ?? [];
    this.state.maxRound = data.maxRound ?? MAX_ROUND;
    this.historyRunId = typeof data.historyRunId === 'number' ? data.historyRunId : null;
    if (Array.isArray(data.currentEvents) && data.currentEvents.length > 0) {
      this.state.currentEvents = data.currentEvents;
    } else if (this.isExplore()) {
      this.generateEvents();
    } else {
      this.state.currentEvents = [];
    }
    this.notify();
  }

  /**
   * 读档后：BD/仓库中 defId 已从模板消失时做迁移。
   * 典型：旧「adventurer」→ 当前默认 starter（human 等）。
   */
  private sanitizeMissingEntityDefs() {
    const starterId = getDefaultStarterId();
    const fixItem = (item: ItemInstance): ItemInstance => {
      if (item.type === 'entity' && !getEntityDef(item.defId)) {
        // 整棵子树无法解析时，用默认 starter 替换该节点
        return this.createItem(starterId, 'entity');
      }
      if (item.children?.length) {
        item.children = item.children.map(fixItem);
      }
      return item;
    };

    this.state.deploySlots = this.state.deploySlots.map(slot => {
      const entity = fixItem(slot.entity);
      const children = (slot.children || []).map(fixItem);
      // 启动端本身缺失时 children 已随 createItem 重建，丢弃旧 children
      if (!getEntityDef(slot.entity.defId)) {
        return { entity, children: [] };
      }
      return { entity, children };
    }).filter(slot => {
      // 保留第一层启动端与木桩；仅丢掉无法解析的实体
      return !!getEntityDef(slot.entity.defId);
    });
    // 允许空 BD：读档保真，不自动补 starter

    this.state.warehouse = this.state.warehouse
      .map(fixItem)
      .filter(item => item.type !== 'entity' || !!getEntityDef(item.defId));
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
