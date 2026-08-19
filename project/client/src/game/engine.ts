// ============================================================
// 游戏引擎 — 状态管理、单存档、敌方BD、分步战斗（v3 统一实体模型）
// ============================================================

import {
  EntityDef, ItemInstance, DeploySlot, DefaultChildSpec,
  getEntityDef, getAffixDef, isStarter, genId, getDefaultStarterId,
  getEffectiveEntitySlots, countUsedSlots,
  findInTree, removeFromTreeChildren, findParentInTree,
  canMountAffix, canRemoveAffix,
  ENTITY_DEFS, AFFIX_DEFS, getEntityCategory,
  getEffectiveValue, getItemTradeValue, OnHitEffect, TargetCondition, TargetingModifier,
  evaluateSubtreeCondition,
  getEffectCatalogMap,
} from './data';
import {
  mergeFiltersWithLegacyFaction, normalizeTargetCount, resolveSortBy,
} from './targetingUtil';
import {
  cloneOnHitEffects,
  migrateLegacyDamageToOnHitEffects,
  normalizeOnHitEffects,
  stampOnHitEffectList,
} from './hitEffectUtil';
import {
  resolvePassiveBonusConfig,
  clonePassiveEffects,
  stampPassiveEffectList,
} from './passiveBonusUtil';
import { resolveActiveBindings } from '@shared/effectResolve';
import type { ActiveChannel } from '@shared/effectDef';
import type { PassiveSourceRuntime } from './battle/types';
import type { SubtreeCondition } from '@shared/types';
import { data as dataApi, saves as savesApi, ApiError } from '../api/client';
import {
  runBattleWithOptionalWorker,
  buildCombatRuntime,
  recomputePassiveBonuses,
  type CombatUnitSnapshot, type CombatUnitRuntime, type CombatEvent,
  type PlaybackSpeed,
} from './battle';
import {
  EVENT_CHOICE_COUNT,
  pickExploreEvents,
  getExploreEventName,
  getPathAffixIds,
  isPathGatedDef,
  type EventStatus,
  type CraftsmanReturnRef,
} from './exploreEvents';
import { createSaveQueue, type SaveQueue } from './saveQueue';

export type {
  CombatUnitSnapshot, CombatUnitRuntime, CombatEvent,
  CombatWeaponRuntime, OnHitContext, PlaybackSpeed,
} from './battle';
export { EVENT_CHOICE_COUNT, getExploreEventName, getExploreEventDesc } from './exploreEvents';
export type { ExploreEventId, EventStatus, CraftsmanReturnRef } from './exploreEvents';

/** 兼容旧存档：1=探险 2=战斗；正式语义以 round 奇偶为准 */
export type GamePhase = 1 | 2;

/** 进行中存档战斗子阶段 */
export type CombatPhase = 'explore' | 'battle_pending' | 'battle_end';

/** 读档恢复决策 */
export type CombatResumeKind = 'explore' | 'replay' | 'end_ui' | 'rollback_explore';

/** 正式局 RNG 协议版本；不匹配则按残缺快照回滚 */
export const COMBAT_RNG_VERSION = 1;

/** 默认最大设计回合（可配置） */
export const MAX_ROUND = 10;

/** 旧档回填：战斗奖合计 + 已走过探险回合的发放额（事件流入无法还原） */
export function estimateTotalGoldGainedFallback(
  battles: BattleRecord[],
  currentRound: number,
  maxRound: number = MAX_ROUND,
): number {
  let total = 0;
  for (const b of battles) total += Number(b.rewardGold) || 0;
  // 已进入过的奇数探险回合：有战斗记录的前一探险 + 当前若在探险则含本趟
  const exploreRounds = new Set<number>();
  for (const b of battles) {
    const er = b.round - 1;
    if (er >= 1 && er % 2 === 1) exploreRounds.add(er);
  }
  if (currentRound % 2 === 1) exploreRounds.add(currentRound);
  for (const er of exploreRounds) {
    if (er > maxRound) continue;
    total += Math.floor((er + 1) / 2) * 10;
  }
  return total;
}

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
  /** 备用资金池：可正可负；进探险静默结算 */
  reserveGold: number;
  /**
   * 本局获取总金币（正流入累计）：探险发放 + 战斗胜奖 + 打工/投资入账。
   * 不含开局现金、出售、购入与刷新支出。
   */
  totalGoldGained: number;
  /** 设计回合 1..MAX_ROUND：奇数=探险，偶数=战斗 */
  round: number;
  /** 与 round 奇偶同步，便于旧 UI/存档 */
  phase: GamePhase;
  warehouse: ItemInstance[];
  deploySlots: DeploySlot[];
  itemPool: string[];
  seed: number;
  /** 本回合事件选项 id */
  currentEvents: string[];
  eventStatus: EventStatus;
  activeEventId: string | null;
  /** 雇佣/走私临时货架 */
  eventOffers: ItemInstance[];
  eventOfferPrices: Record<string, number>;
  /** 工匠单槽 */
  craftsmanSlot: ItemInstance | null;
  craftsmanReturn: CraftsmanReturnRef | null;
  /** 本回合商店货架 */
  shopOffers: ItemInstance[];
  shopRefreshCount: number;
  /** @deprecated 兼容旧存档 */
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

/** 导出供单测 / 正式局重播使用 */
export { seededRandom };

export class GameEngine {
  state!: GameState;
  username = '';
  /** 关联历史归档 id；首战 upsert 后写入存档 */
  historyRunId: number | null = null;

  onStateChange?: () => void;
  onToast?: (msg: string) => void;
  /** 自动存失败（非 401）；UI 注入 toast */
  onSaveError?: (msg: string, err?: unknown) => void;
  /** 存档/API 401；UI 弹登录，勿开战回滚 */
  onAuthExpired?: () => void;
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

  /** 存档战斗子阶段 */
  combatPhase: CombatPhase = 'explore';
  pendingEnemyBd: DeploySlot[] | null = null;
  pendingAutoWin = false;
  combatSeed: number | null = null;
  combatResultSummary: { win: boolean; gold: number; autoWin: boolean } | null = null;
  combatRngVersion = COMBAT_RNG_VERSION;
  /** 拖拽中禁止提交型存 */
  suppressExploreSave = false;
  /** 结束态 history sync 失败时，点继续前需重试 */
  historySyncPending = false;

  private saveQueue: SaveQueue;
  private saveFailToasted = false;

  constructor() {
    this.saveQueue = createSaveQueue({
      getPayload: () => this.toSaveData(),
      put: async (payload) => { await savesApi.put(payload); },
      onError: (e) => this.handleSaveError(e, false),
    });
    this.resetState();
  }

  resetState() {
    this.state = {
      gold: 30, reserveGold: 0, totalGoldGained: 0, round: 1, phase: 1,
      warehouse: [], deploySlots: [], itemPool: [], seed: Date.now(),
      currentEvents: [], eventStatus: 'pending', activeEventId: null,
      eventOffers: [], eventOfferPrices: {},
      craftsmanSlot: null, craftsmanReturn: null,
      shopOffers: [], shopRefreshCount: 0,
      visitedEventMerchants: [], growthStacks: {},
      quickWarehouseCollapsed: false, battles: [], maxRound: MAX_ROUND,
    };
    this.rebuildItemPool();
    this.rightPanel = null;
    this.historyRunId = null;
    this.clearCombatSnapshot();
    this.historySyncPending = false;
    this.enterExploreSetup({ autoSave: false });
    this.notify();
  }

  /** 是否探险阶段（奇数回合） */
  isExplore(): boolean { return this.state.round % 2 === 1; }
  /** 是否战斗阶段（偶数回合） */
  isBattlePhase(): boolean { return this.state.round % 2 === 0; }
  syncPhaseFromRound() { this.state.phase = this.isExplore() ? 1 : 2; }

  /** 探险发放额（入池用，不直接改 gold） */
  getExploreGrantAmount(): number {
    return Math.floor((this.state.round + 1) / 2) * 10;
  }

  /** 累计本局获取（探险/战斗/事件正流入） */
  private recordGoldGained(amount: number) {
    if (amount > 0) this.state.totalGoldGained += amount;
  }

  /** @deprecated 保留名称；现改为入池+结算，见 enterExploreSetup */
  grantExploreGold(): number {
    const amount = this.getExploreGrantAmount();
    this.addReserve(amount);
    this.recordGoldGained(amount);
    this.settleReserveWithGold();
    return amount;
  }

  addReserve(delta: number) {
    this.state.reserveGold += delta;
  }

  /** 静默结算备用池 ↔ 现金 */
  settleReserveWithGold(): number {
    const r = this.state.reserveGold;
    if (r > 0) {
      this.state.gold += r;
      this.state.reserveGold = 0;
      return r;
    }
    if (r < 0) {
      const pay = Math.min(this.state.gold, -r);
      this.state.gold -= pay;
      this.state.reserveGold += pay;
      return -pay;
    }
    return 0;
  }

  /** 进入探险：入账本趟发放 → 静默结算 → 重置商店/事件 */
  enterExploreSetup(opts?: { autoSave?: boolean }) {
    const grant = this.getExploreGrantAmount();
    this.addReserve(grant);
    this.recordGoldGained(grant);
    this.settleReserveWithGold();
    this.state.shopRefreshCount = 0;
    this.clearEventRuntime();
    this.rollShopOffers();
    this.generateEvents();
    if (opts?.autoSave !== false) {
      // 开局 reset 时 username 可能未就绪，失败仅 warn
      this.requestSave({ reason: 'explore-enter' });
    }
  }

  clearEventRuntime() {
    this.state.eventStatus = 'pending';
    this.state.activeEventId = null;
    this.state.eventOffers = [];
    this.state.eventOfferPrices = {};
    this.state.craftsmanSlot = null;
    this.state.craftsmanReturn = null;
    this.state.visitedEventMerchants = [];
  }

  /** 战斗获胜金：floor((round+1)/2)×5 */
  getBattleWinGold(): number {
    return Math.floor((this.state.round + 1) / 2) * 5;
  }

  rebuildItemPool() {
    this.recomputeItemPool();
  }

  /** 收集当前持有 defId（仓库 + BD 子树；实体计入模板 fixedAffixes） */
  collectOwnedDefIds(): Set<string> {
    const owned = new Set<string>();
    const visit = (item: ItemInstance) => {
      if (item.defId) owned.add(item.defId);
      if (item.type === 'entity') {
        const def = getEntityDef(item.defId);
        for (const affixId of def?.fixedAffixes || []) owned.add(affixId);
      }
      for (const c of item.children || []) visit(c);
    };
    for (const w of this.state.warehouse) visit(w);
    for (const slot of this.state.deploySlots) {
      visit(slot.entity);
      for (const c of slot.children || []) visit(c);
    }
    return owned;
  }

  /** 按当前持有整表重建可售/可抽商品 id（出售后前置消失则立刻出池） */
  recomputeItemPool(): void {
    const owned = this.collectOwnedDefIds();
    const pool: string[] = [];
    for (const def of ENTITY_DEFS) {
      if (def.poolPrerequisite.every(p => owned.has(p))) pool.push(def.id);
    }
    for (const def of AFFIX_DEFS) {
      if (def.poolPrerequisite.every(p => owned.has(p))) pool.push(def.id);
    }
    this.state.itemPool = pool;
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
  /** 递归搜索：先查仓库，再递归查 deploySlots 树，再查工匠槽 */
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
    if (this.state.craftsmanSlot) {
      if (this.state.craftsmanSlot.instanceId === instanceId) return this.state.craftsmanSlot;
      const found = findInTree(this.state.craftsmanSlot, instanceId);
      if (found) return found;
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
      const inEnt = findInTree(slot.entity, parentInstanceId);
      if (inEnt) return inEnt;
    }
    return null;
  }

  /** 查找某实例当前挂载的父实体（仓库树或出场 BD） */
  findParentOfItem(instanceId: string): ItemInstance | null {
    for (const w of this.state.warehouse) {
      if (w.type !== 'entity') continue;
      const p = findParentInTree(w, instanceId);
      if (p) return p;
    }
    for (const slot of this.state.deploySlots) {
      if ((slot.entity.children || []).some(c => c.instanceId === instanceId)) return slot.entity;
      if ((slot.children || []).some(c => c.instanceId === instanceId)) return slot.entity;
      const p = findParentInTree(slot.entity, instanceId);
      if (p) return p;
      for (const c of slot.children || []) {
        const p2 = findParentInTree(c, instanceId);
        if (p2) return p2;
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

    // 计算有效槽位和已用槽位（含 overrides，如工匠强化）
    const effectiveSlots = getEffectiveEntitySlots(parent);
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

      // 从原父迁走：先校验依赖（目标相同父则仅重挂，不拦）
      const oldParent = this.findParentOfItem(item.instanceId);
      const targetParentHint = pid !== null
        ? (this.findParentEntity(pid, targetSlotIdx) || (this.findItem(pid)?.type === 'entity' ? this.findItem(pid)! : null))
        : (this.state.deploySlots[targetSlotIdx]?.entity ?? null);
      if (oldParent && (!targetParentHint || oldParent.instanceId !== targetParentHint.instanceId)) {
        const rmErr = canRemoveAffix(oldParent, item.instanceId);
        if (rmErr) return rmErr;
      }

      if (pid !== null) {
        const parentEntity = this.findParentEntity(pid, targetSlotIdx)
          || (this.findItem(pid)?.type === 'entity' ? this.findItem(pid)! : null);
        if (!parentEntity) return '父实体不存在';
        const mountErr = canMountAffix(parentEntity, item.defId);
        if (mountErr) return mountErr;
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        if (!parentEntity.children) parentEntity.children = [];
        parentEntity.children.push(item);
      } else {
        const slot = this.state.deploySlots[targetSlotIdx];
        if (!slot) return '槽位不存在';
        const mountErr = canMountAffix(slot.entity, item.defId, slot.children);
        if (mountErr) return mountErr;
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        slot.children.push(item);
      }
      this.notify(); return null;
    }
    return '无法放置';
  }
  /** 卸到仓库；挂在实体下的词条若被依赖则拒绝 */
  moveToWarehouse(item: ItemInstance): string | null {
    if (item.type === 'affix') {
      const parent = this.findParentOfItem(item.instanceId);
      if (parent) {
        const err = canRemoveAffix(parent, item.instanceId);
        if (err) return err;
      }
    }
    this.removeFromDeploy(item.instanceId);
    for (const w of this.state.warehouse) {
      if (w.type === 'entity') removeFromTreeChildren(w, item.instanceId);
    }
    if (!this.state.warehouse.some(i => i.instanceId === item.instanceId)) {
      this.state.warehouse.push(item);
    }
    this.notify();
    return null;
  }
  /** @returns 成交价；失败返回错误文案；找不到物品返回 null */
  sellItem(item: ItemInstance): number | string | null {
    const def = this.getDef(item); if (!def) return null;
    if (item.type === 'affix') {
      const parent = this.findParentOfItem(item.instanceId);
      if (parent) {
        const err = canRemoveAffix(parent, item.instanceId);
        if (err) return err;
      }
    }
    const price = Math.floor(getItemTradeValue(item) / 2);
    const wi = this.state.warehouse.findIndex(i => i.instanceId === item.instanceId);
    if (wi !== -1) { this.state.warehouse.splice(wi, 1); this.state.gold += price; this.notify(); return price; }
    const r = this.removeFromDeploy(item.instanceId);
    if (r) { this.state.gold += price; this.notify(); return price; }
    for (const w of this.state.warehouse) {
      if (w.type !== 'entity') continue;
      const removed = removeFromTreeChildren(w, item.instanceId);
      if (removed) { this.state.gold += price; this.notify(); return price; }
    }
    return null;
  }
  buyItem(item: ItemInstance, priceOverride?: number): string | null {
    const price = priceOverride ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price; this.addToWarehouse(item); return null;
  }
  buyAndEquip(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null, priceOverride?: number): string | null {
    const price = priceOverride ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    // 先装备：失败则不扣金（避免槽位不足吞金后 HUD 与引擎不同步）
    const err = this.moveToDeploy(item, targetSlotIdx, parentInstanceId);
    if (err) return err;
    this.state.gold -= price;
    this.notify();
    return null;
  }

  /** 生成商店物品列表（不限数量，仅价值限制）— 旧逻辑保留供兼容；正式探险用 rollShopOffers */
  generateShopItems(filter: 'all' | 'entity' | 'affix'): ItemInstance[] {
    this.recomputeItemPool();
    const cap = this.getMerchantValueCap();
    const items: ItemInstance[] = [];

    if (filter === 'all' || filter === 'entity') {
      for (const def of ENTITY_DEFS) {
        if (def.value > cap) continue;
        if (!this.state.itemPool.includes(def.id)) continue;
        items.push(this.createItem(def.id, 'entity'));
      }
    }

    if (filter === 'all' || filter === 'affix') {
      for (const def of AFFIX_DEFS) {
        if (Math.abs(def.costValue) > cap) continue;
        if (!this.state.itemPool.includes(def.id)) continue;
        items.push(this.createItem(def.id, 'affix'));
      }
    }

    return items;
  }

  getShopRefreshCost(): number {
    return 2 * (this.state.shopRefreshCount + 1);
  }

  /** 有放回抽 6 实体 + 3 词条 */
  rollShopOffers() {
    this.recomputeItemPool();
    const cap = this.getMerchantValueCap();
    const rand = seededRandom(this.state.seed + this.state.round * 1000 + this.state.shopRefreshCount * 17 + 3);
    const ents = ENTITY_DEFS.filter(d => d.value <= cap && this.state.itemPool.includes(d.id));
    const affs = AFFIX_DEFS.filter(d => Math.abs(d.costValue) <= cap && this.state.itemPool.includes(d.id));
    const offers: ItemInstance[] = [];
    for (let i = 0; i < 6 && ents.length > 0; i++) {
      const def = ents[Math.floor(rand() * ents.length)];
      offers.push(this.createItem(def.id, 'entity'));
    }
    for (let i = 0; i < 3 && affs.length > 0; i++) {
      const def = affs[Math.floor(rand() * affs.length)];
      offers.push(this.createItem(def.id, 'affix'));
    }
    this.state.shopOffers = offers;
  }

  refreshShop(): string | null {
    const cost = this.getShopRefreshCost();
    if (this.state.gold < cost) return `金币不足(需${cost},有${this.state.gold})`;
    this.state.gold -= cost;
    this.state.shopRefreshCount += 1;
    this.rollShopOffers();
    this.notify();
    return null;
  }

  /** 从商店货架购买：移除货架项 */
  buyFromShopOffer(item: ItemInstance, priceOverride?: number): string | null {
    const idx = this.state.shopOffers.findIndex(i => i.instanceId === item.instanceId);
    if (idx < 0) return '商品不在货架上';
    const price = priceOverride ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price;
    this.state.shopOffers.splice(idx, 1);
    this.addToWarehouse(item);
    return null;
  }

  buyAndEquipFromShop(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null, priceOverride?: number): string | null {
    const idx = this.state.shopOffers.findIndex(i => i.instanceId === item.instanceId);
    if (idx < 0) return '商品不在货架上';
    const price = priceOverride ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    const err = this.moveToDeploy(item, targetSlotIdx, parentInstanceId);
    if (err) return err;
    this.state.gold -= price;
    const still = this.state.shopOffers.findIndex(i => i.instanceId === item.instanceId);
    if (still >= 0) this.state.shopOffers.splice(still, 1);
    this.notify();
    return null;
  }

  takeFromShopOffer(instanceId: string): ItemInstance | null {
    const idx = this.state.shopOffers.findIndex(i => i.instanceId === instanceId);
    if (idx < 0) return null;
    const [item] = this.state.shopOffers.splice(idx, 1);
    return item;
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
    this.resolveActiveEventOnBattle();
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
      this.clearCombatSnapshot();
      return 'settlement';
    }
    this.clearCombatSnapshot();
    this.state.round += 1;
    this.syncPhaseFromRound();
    this.enterExploreSetup({ autoSave: true });
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
    const rand = seededRandom(this.state.seed + this.state.round * 100 + 7);
    this.state.currentEvents = pickExploreEvents(
      this.state.round,
      this.state.maxRound,
      EVENT_CHOICE_COUNT,
      rand,
    );
    this.state.eventStatus = 'pending';
    this.state.activeEventId = null;
  }

  getEventName(id: string): string {
    return getExploreEventName(id);
  }

  getNextExploreShopCap(): number {
    const nextExploreRound = this.state.round + 2;
    if (nextExploreRound > this.state.maxRound) {
      return this.getMerchantValueCap() + 20;
    }
    return nextExploreRound * 10;
  }

  /** 点选事件卡：立刻锁定 */
  beginEvent(eventId: string): string | null {
    if (!this.isExplore()) return '非探险阶段';
    if (this.state.eventStatus === 'done') return '本回合事件已结束';
    if (this.state.eventStatus === 'active') return '已有进行中的事件';
    if (!this.state.currentEvents.includes(eventId)) return '无效事件';
    this.state.eventStatus = 'active';
    this.state.activeEventId = eventId;
    this.state.eventOffers = [];
    this.state.eventOfferPrices = {};
    if (eventId === 'hire') this.rollHireOffers();
    else if (eventId === 'smuggler') this.rollSmugglerOffers();
    else if (eventId === 'open_path') this.rollOpenPathOffers();
    else if (eventId === 'path_merchant') this.rollPathMerchantOffers();
    this.notify();
    return null;
  }

  completeEvent() {
    this.flushCraftsmanToReturn(false);
    this.state.eventOffers = [];
    this.state.eventOfferPrices = {};
    this.state.eventStatus = 'done';
    this.state.activeEventId = null;
    this.notify();
  }

  /** 开战前收束进行中事件 */
  resolveActiveEventOnBattle() {
    if (this.state.eventStatus !== 'active') return;
    this.flushCraftsmanToReturn(false);
    this.state.eventOffers = [];
    this.state.eventOfferPrices = {};
    this.state.eventStatus = 'done';
    this.state.activeEventId = null;
  }

  rollHireOffers() {
    this.recomputeItemPool();
    const cap = this.getMerchantValueCap();
    const rand = seededRandom(this.state.seed + this.state.round * 333 + 11);
    const starters = ENTITY_DEFS.filter(
      d => isStarter(d) && d.value <= cap && this.state.itemPool.includes(d.id),
    );
    const offers: ItemInstance[] = [];
    const prices: Record<string, number> = {};
    for (let i = 0; i < 6 && starters.length > 0; i++) {
      const def = starters[Math.floor(rand() * starters.length)];
      const item = this.createItem(def.id, 'entity');
      offers.push(item);
      prices[item.instanceId] = getItemTradeValue(item);
    }
    this.state.eventOffers = offers;
    this.state.eventOfferPrices = prices;
  }

  rollSmugglerOffers() {
    this.recomputeItemPool();
    const cap = this.getMerchantValueCap();
    const nextCap = this.getNextExploreShopCap();
    const rand = seededRandom(this.state.seed + this.state.round * 444 + 13);
    const ents = ENTITY_DEFS.filter(
      d => d.value > cap && d.value <= nextCap && this.state.itemPool.includes(d.id),
    );
    const affs = AFFIX_DEFS.filter(d => {
      const v = Math.abs(d.costValue);
      return v > cap && v <= nextCap && this.state.itemPool.includes(d.id);
    });
    const offers: ItemInstance[] = [];
    const prices: Record<string, number> = {};
    for (let i = 0; i < 6 && ents.length > 0; i++) {
      const def = ents[Math.floor(rand() * ents.length)];
      const item = this.createItem(def.id, 'entity');
      offers.push(item);
      prices[item.instanceId] = Math.floor(getItemTradeValue(item) * 1.5);
    }
    for (let i = 0; i < 3 && affs.length > 0; i++) {
      const def = affs[Math.floor(rand() * affs.length)];
      const item = this.createItem(def.id, 'affix');
      offers.push(item);
      prices[item.instanceId] = Math.floor(getItemTradeValue(item) * 1.5);
    }
    this.state.eventOffers = offers;
    this.state.eventOfferPrices = prices;
  }

  rollOpenPathOffers() {
    const offers: ItemInstance[] = [];
    const prices: Record<string, number> = {};
    for (const def of AFFIX_DEFS) {
      if (def.category !== 'path') continue;
      const item = this.createItem(def.id, 'affix');
      offers.push(item);
      prices[item.instanceId] = getItemTradeValue(item);
    }
    this.state.eventOffers = offers;
    this.state.eventOfferPrices = prices;
  }

  /** 路线商人：itemPool 内路线解锁物，有放回 6 实体 + 3 词条，原价 */
  rollPathMerchantOffers() {
    this.recomputeItemPool();
    const pathIds = getPathAffixIds();
    const rand = seededRandom(this.state.seed + this.state.round * 555 + 17);
    const ents = ENTITY_DEFS.filter(
      d => this.state.itemPool.includes(d.id) && isPathGatedDef(d, pathIds),
    );
    const affs = AFFIX_DEFS.filter(
      d => this.state.itemPool.includes(d.id) && isPathGatedDef(d, pathIds),
    );
    const offers: ItemInstance[] = [];
    const prices: Record<string, number> = {};
    for (let i = 0; i < 6 && ents.length > 0; i++) {
      const def = ents[Math.floor(rand() * ents.length)];
      const item = this.createItem(def.id, 'entity');
      offers.push(item);
      prices[item.instanceId] = getItemTradeValue(item);
    }
    for (let i = 0; i < 3 && affs.length > 0; i++) {
      const def = affs[Math.floor(rand() * affs.length)];
      const item = this.createItem(def.id, 'affix');
      offers.push(item);
      prices[item.instanceId] = getItemTradeValue(item);
    }
    this.state.eventOffers = offers;
    this.state.eventOfferPrices = prices;
  }

  buyFromEventOffer(item: ItemInstance): string | null {
    const idx = this.state.eventOffers.findIndex(i => i.instanceId === item.instanceId);
    if (idx < 0) return '商品不在事件货架上';
    const price = this.state.eventOfferPrices[item.instanceId] ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price;
    this.state.eventOffers.splice(idx, 1);
    delete this.state.eventOfferPrices[item.instanceId];
    this.addToWarehouse(item);
    return null;
  }

  buyAndEquipFromEvent(item: ItemInstance, targetSlotIdx?: number, parentInstanceId?: string | null): string | null {
    const idx = this.state.eventOffers.findIndex(i => i.instanceId === item.instanceId);
    if (idx < 0) return '商品不在事件货架上';
    const price = this.state.eventOfferPrices[item.instanceId] ?? getItemTradeValue(item);
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    const err = this.moveToDeploy(item, targetSlotIdx, parentInstanceId);
    if (err) return err;
    this.state.gold -= price;
    const still = this.state.eventOffers.findIndex(i => i.instanceId === item.instanceId);
    if (still >= 0) this.state.eventOffers.splice(still, 1);
    delete this.state.eventOfferPrices[item.instanceId];
    this.notify();
    return null;
  }

  doWorkEvent(): string | null {
    if (this.state.activeEventId !== 'work') return '非打工事件';
    this.state.gold += 10;
    this.recordGoldGained(10);
    this.completeEvent();
    return null;
  }

  doInvestEvent(): string | null {
    if (this.state.activeEventId !== 'invest') return '非投资事件';
    if (this.state.gold < 10) return `金币不足(需10,有${this.state.gold})`;
    this.state.gold -= 10;
    this.addReserve(15);
    this.recordGoldGained(15);
    return null;
  }

  /** 九出十三归：每次 +9 金、备用池 −13；同次可连点，不自动结束 */
  doNineThirteenEvent(): string | null {
    if (this.state.activeEventId !== 'nine_thirteen') return '非九出十三归事件';
    this.state.gold += 9;
    this.recordGoldGained(9);
    this.addReserve(-13);
    return null;
  }

  /**
   * 将实体移入工匠槽（真正移出）。
   * @returns 错误文案
   */
  moveEntityToCraftsman(item: ItemInstance): string | null {
    if (item.type !== 'entity') return '只能放入实体';
    if (this.state.craftsmanSlot) return '工匠槽已有实体';
    // 记录归位信息
    const whIdx = this.state.warehouse.findIndex(i => i.instanceId === item.instanceId);
    let ret: CraftsmanReturnRef | null = null;
    if (whIdx >= 0) {
      ret = { kind: 'warehouse', warehouseIndex: whIdx };
      this.state.warehouse.splice(whIdx, 1);
    } else {
      // BD：顶层或子树
      const topIdx = this.state.deploySlots.findIndex(s => s.entity.instanceId === item.instanceId);
      if (topIdx >= 0) {
        ret = { kind: 'deploy', wasTopLevel: true, slotIdx: topIdx };
        this.state.deploySlots.splice(topIdx, 1);
      } else {
        const parent = this.findParentOfItem(item.instanceId);
        if (!parent) return '找不到实体';
        const childIdx = (parent.children || []).findIndex(c => c.instanceId === item.instanceId);
        let slotIdx = 0;
        for (let i = 0; i < this.state.deploySlots.length; i++) {
          if (findInTree(this.state.deploySlots[i].entity, parent.instanceId)
            || this.state.deploySlots[i].entity.instanceId === parent.instanceId) {
            slotIdx = i;
            break;
          }
        }
        ret = {
          kind: 'deploy',
          wasTopLevel: false,
          parentId: parent.instanceId,
          slotIdx,
          childIndex: childIdx,
        };
        this.removeFromDeploy(item.instanceId);
        for (const w of this.state.warehouse) {
          if (w.type === 'entity') removeFromTreeChildren(w, item.instanceId);
        }
      }
    }
    this.state.craftsmanSlot = item;
    this.state.craftsmanReturn = ret;
    this.notify();
    return null;
  }

  /**
   * 从工匠槽取出实体（不自动归位），供拖回 BD/仓库换实体。
   * 清除归位信息；调用方负责放入目标位置。
   */
  extractCraftsmanItem(): ItemInstance | null {
    const item = this.state.craftsmanSlot;
    if (!item) return null;
    this.state.craftsmanSlot = null;
    this.state.craftsmanReturn = null;
    this.notify();
    return item;
  }

  private flushCraftsmanToReturn(_upgraded: boolean) {
    const item = this.state.craftsmanSlot;
    if (!item) {
      this.state.craftsmanReturn = null;
      return;
    }
    const ret = this.state.craftsmanReturn;
    this.state.craftsmanSlot = null;
    this.state.craftsmanReturn = null;
    if (!ret) {
      this.state.warehouse.push(item);
      return;
    }
    if (ret.kind === 'warehouse') {
      const idx = Math.min(ret.warehouseIndex ?? this.state.warehouse.length, this.state.warehouse.length);
      this.state.warehouse.splice(idx, 0, item);
      return;
    }
    if (ret.wasTopLevel) {
      const idx = Math.min(ret.slotIdx ?? this.state.deploySlots.length, this.state.deploySlots.length);
      // 槽位可能不够：尝试 push
      const slots = this.getFirstLayerSlots();
      const used = this.state.deploySlots.reduce((s, d) => {
        const def = getEntityDef(d.entity.defId);
        return s + (def?.slotCost ?? 1);
      }, 0);
      const cost = getEntityDef(item.defId)?.slotCost ?? 1;
      if (used + cost <= slots) {
        this.state.deploySlots.splice(idx, 0, { entity: item, children: [] });
      } else {
        this.state.warehouse.push(item);
      }
      return;
    }
    if (ret.parentId) {
      const parent = this.findItem(ret.parentId);
      const childDef = getEntityDef(item.defId);
      if (parent && parent.type === 'entity' && childDef) {
        if (!parent.children) parent.children = [];
        const err = this.canEquipToSlot(ret.slotIdx ?? 0, ret.parentId, childDef);
        if (!err) {
          const at = Math.min(ret.childIndex ?? parent.children.length, parent.children.length);
          parent.children.splice(at, 0, item);
          return;
        }
      }
    }
    this.state.warehouse.push(item);
  }

  applyCraftsmanUpgrade(
    choice: 'hp' | 'hpRegen' | 'staminaRegen' | 'maxStamina' | 'maxLoad' | 'dynamicAffixSlots' | 'entitySlots',
  ): string | null {
    const item = this.state.craftsmanSlot;
    if (!item || item.type !== 'entity') return '请先放入实体';
    const def = getEntityDef(item.defId);
    if (!def) return '实体模板不存在';
    if (!item.overrides) item.overrides = {};
    const cur = (field: keyof EntityDef) => Number(getEffectiveValue(item, field) ?? (def as any)[field] ?? 0);
    const bump: Partial<EntityDef> = {};
    switch (choice) {
      case 'hp': bump.hp = cur('hp') + 100; break;
      case 'hpRegen': bump.hpRegen = cur('hpRegen') + 2; break;
      case 'staminaRegen': bump.staminaRegen = cur('staminaRegen') + 1; break;
      case 'maxStamina': bump.maxStamina = cur('maxStamina') + 50; break;
      case 'maxLoad': bump.maxLoad = cur('maxLoad') + 10000; break;
      case 'dynamicAffixSlots': bump.dynamicAffixSlots = cur('dynamicAffixSlots') + 1; break;
      case 'entitySlots': bump.entitySlots = cur('entitySlots') + 1; break;
    }
    Object.assign(item.overrides, bump);
    this.flushCraftsmanToReturn(true);
    this.state.eventStatus = 'done';
    this.state.activeEventId = null;
    this.notify();
    return null;
  }

  /** 递归计算战斗快照：遍历嵌套的装备树，聚合所有加成（v5: 支持 ItemInstance.overrides） */
  /** 宿主贡献袋：优先通道 bindings 解析，否则读已解析 onHitEffects */
  private collectHostOnHitBag(host: ItemInstance, extraChildLists: ItemInstance[][] = []): OnHitEffect[] {
    const def = getEntityDef(host.defId);
    if (!def) return [];
    const channel = ((host.overrides as any)?.activeChannel ?? def.activeChannel) as ActiveChannel | undefined;
    let raw: OnHitEffect[] | undefined;
    if (channel?.effectBindings?.length) {
      raw = resolveActiveBindings(channel.effectBindings, getEffectCatalogMap(), def.name);
    } else {
      raw = (host.overrides?.onHitEffects ?? def.onHitEffects) as OnHitEffect[] | undefined;
    }
    const damage = Number(getEffectiveValue(host, 'damage') ?? def.damage ?? 0);
    const bag = migrateLegacyDamageToOnHitEffects(raw, damage);
    const entityName = def.name?.trim();
    if (entityName) stampOnHitEffectList(bag, entityName);
    for (const list of [host.children || [], ...extraChildLists]) {
      for (const c of list) {
        if (c.type !== 'affix') continue;
        const adef = getAffixDef(c.defId);
        if (!adef) continue;
        const aCh = adef.activeChannel;
        let affixEffects: OnHitEffect[] = [];
        if (aCh?.effectBindings?.length) {
          affixEffects = resolveActiveBindings(aCh.effectBindings, getEffectCatalogMap(), adef.name);
        } else if (adef.onHitEffects?.length) {
          affixEffects = cloneOnHitEffects(normalizeOnHitEffects(adef.onHitEffects));
        }
        if (!affixEffects.length) continue;
        const affixName = adef.name?.trim();
        if (affixName) stampOnHitEffectList(affixEffects, affixName);
        bag.push(...affixEffects);
      }
    }
    return bag;
  }

  /** 递归收集子树所有词条的 defId（含实体 fixedAffixes） */
  private collectAffixIds(item: ItemInstance): string[] {
    const ids: string[] = [];
    if (item.type === 'affix') {
      ids.push(item.defId);
    } else if (item.type === 'entity') {
      const edef = getEntityDef(item.defId);
      const fixed = item.overrides?.fixedAffixes ?? edef?.fixedAffixes ?? [];
      ids.push(...fixed);
    }
    for (const c of item.children || []) {
      ids.push(...this.collectAffixIds(c));
    }
    return ids;
  }

  private collectPassiveSourcesFromTree(
    item: ItemInstance,
    rootInstanceId: string,
    into: PassiveSourceRuntime[],
    parentEntityName?: string,
    conditionRoots?: ItemInstance[],
  ): void {
    if (item.type === 'entity') {
      const cdef = getEntityDef(item.defId);
      const entityName = cdef?.name?.trim();
      if (cdef) {
        const cfg = resolvePassiveBonusConfig({
          hasPassiveBonuses: Boolean(getEffectiveValue(item, 'hasPassiveBonuses') ?? cdef.hasPassiveBonuses),
          passiveEffects: getEffectiveValue(item, 'passiveEffects') ?? cdef.passiveEffects,
          passiveTargetCondition: getEffectiveValue(item, 'passiveTargetCondition') ?? cdef.passiveTargetCondition,
          passiveTargetCount: getEffectiveValue(item, 'passiveTargetCount') ?? cdef.passiveTargetCount,
          hpBonus: Number(getEffectiveValue(item, 'hpBonus') ?? cdef.hpBonus ?? 0),
          hpRegenerationBonus: Number(getEffectiveValue(item, 'hpRegenerationBonus') ?? cdef.hpRegenerationBonus ?? 0),
          staminaBonus: Number(getEffectiveValue(item, 'staminaBonus') ?? cdef.staminaBonus ?? 0),
          staminaRegenerationBonus: Number(getEffectiveValue(item, 'staminaRegenerationBonus') ?? cdef.staminaRegenerationBonus ?? 0),
          loadBonus: Number(getEffectiveValue(item, 'loadBonus') ?? cdef.loadBonus ?? 0),
        });
        if (cfg.hasPassiveBonuses && cfg.passiveEffects.length > 0) {
          const filtered = cfg.passiveEffects.filter(e =>
            !e.condition || this.evaluateCondition(e.condition, conditionRoots),
          );
          if (filtered.length > 0) {
            const effects = clonePassiveEffects(filtered);
            if (entityName) stampPassiveEffectList(effects, entityName);
            into.push({
              ownerItemInstanceId: item.instanceId,
              ownerName: entityName || undefined,
              effects,
              targetCondition: {
                sortBy: cfg.passiveTargetCondition.sortBy || 'random',
                filterBy: [...(cfg.passiveTargetCondition.filterBy || [])],
              },
              targetCount: cfg.passiveTargetCount,
            });
          }
        }
      }
      for (const c of item.children || []) {
        this.collectPassiveSourcesFromTree(c, rootInstanceId, into, entityName || undefined, conditionRoots);
      }
    } else if (item.type === 'affix') {
      const adef = getAffixDef(item.defId);
      if (!adef) return;
      const cfg = resolvePassiveBonusConfig({
        hasPassiveBonuses: adef.hasPassiveBonuses === true,
        passiveEffects: adef.passiveEffects,
        passiveTargetCondition: adef.passiveTargetCondition,
        passiveTargetCount: adef.passiveTargetCount,
        hpBonus: adef.hpBonus,
        hpRegenerationBonus: adef.hpRegenerationBonus,
        staminaBonus: adef.staminaBonus,
        staminaRegenerationBonus: adef.staminaRegenerationBonus,
        loadBonus: adef.loadBonus,
      });
      if (cfg.hasPassiveBonuses && cfg.passiveEffects.length > 0) {
        const filtered = cfg.passiveEffects.filter(e =>
          !e.condition || this.evaluateCondition(e.condition, conditionRoots),
        );
        if (filtered.length > 0) {
          const effects = clonePassiveEffects(filtered);
          const affixName = adef.name?.trim();
          if (affixName) stampPassiveEffectList(effects, affixName);
          into.push({
            ownerItemInstanceId: item.instanceId,
            ownerName: parentEntityName || affixName || undefined,
            effects,
            targetCondition: {
              sortBy: cfg.passiveTargetCondition.sortBy || 'random',
              filterBy: [...(cfg.passiveTargetCondition.filterBy || [])],
            },
            targetCount: cfg.passiveTargetCount,
          });
        }
      }
    }
  }

  private evaluateCondition(
    cond: SubtreeCondition,
    conditionRoots?: ItemInstance[],
  ): boolean {
    return evaluateSubtreeCondition(cond, conditionRoots || []);
  }

  private collectFromChildren(
    children: ItemInstance[],
    growthStack: number,
    conditionRoots?: ItemInstance[],
  ): {
    totalLoad: number;
    weapons: CombatUnitSnapshot['activeWeapons'];
  } {
    let totalLoad = 0;
    const weapons: CombatUnitSnapshot['activeWeapons'] = [];

    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;

        totalLoad += Number(getEffectiveValue(child, 'weight') ?? 0);

        const isActive = getEffectiveValue(child, 'isActive') ?? cdef.isActive;
        if (isActive) {
          const entityTargetingMods = this._collectEntityTargetingMods(child.children);
          let localBag = this.collectHostOnHitBag(child);
          // 子树条件过滤：child 的 onHitEffects 基于 child 的子树统计
          localBag = localBag.filter(e =>
            !(e as any).condition || this.evaluateCondition((e as any).condition, conditionRoots),
          );
          if (growthStack) {
            localBag = cloneOnHitEffects(localBag);
            const dmgEff = localBag.find(e => e.stat === 'hp' && e.op === 'loss');
            if (dmgEff) {
              dmgEff.params = { ...dmgEff.params, amount: (dmgEff.params.amount ?? 0) + growthStack };
            } else {
              localBag.unshift({
                displayName: '伤害',
                stat: 'hp',
                op: 'loss',
                params: { amount: growthStack },
                applyTo: ['target'],
              });
            }
          }
          weapons.push({
            name: String(getEffectiveValue(child, 'name') ?? cdef.name),
            actionTime: Number(getEffectiveValue(child, 'actionTime') ?? 0),
            damage: 0,
            staminaCost: Number(getEffectiveValue(child, 'staminaCost') ?? 0),
            ...this._resolveWeaponTargeting(entityTargetingMods, child, cdef),
            ownerInstanceId: child.instanceId,
            onHitEffects: localBag,
          });
        }
        if (child.children && child.children.length > 0) {
          const nested = this.collectFromChildren(child.children, growthStack, conditionRoots);
          totalLoad += nested.totalLoad;
          for (const w of nested.weapons) weapons.push(w);
        }
      }
    }
    return { totalLoad, weapons };
  }

  /** 从 DeploySlot 构建 CombatUnitSnapshot（v4：递归嵌套）。可传入自定义 slots 用于模拟对战。 */
  calculateCombatSnapshots(slots?: DeploySlot[]): { snapshots: CombatUnitSnapshot[]; onHitEffects: Map<string, OnHitEffect[]> } {
    const deploySlots = slots ?? this.state.deploySlots;
    const units: CombatUnitSnapshot[] = [];
    const entityOnHitEffects = new Map<string, OnHitEffect[]>();

    for (let slotIdx = 0; slotIdx < deploySlots.length; slotIdx++) {
      const slot = deploySlots[slotIdx];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;

      const growthStack = this.state.growthStacks[slot.entity.instanceId] || 0;
      const allChildren = [...(slot.entity.children || []), ...slot.children];

      // 条件 / has_affix 同源：启动端实体 + slot 直属子项（递归计入 fixed 与实例）
      const conditionRoots: ItemInstance[] = [slot.entity, ...slot.children];

      const collected = isStarter(edef)
        ? this.collectFromChildren(allChildren, growthStack, conditionRoots)
        : { totalLoad: 0, weapons: [] as CombatUnitSnapshot['activeWeapons'] };

      // 非 starter 仍统计负重（木桩可负重）
      if (!isStarter(edef)) {
        const loadOnly = this.collectFromChildren(allChildren, 0, conditionRoots);
        collected.totalLoad = loadOnly.totalLoad;
      }

      const passiveSources: PassiveSourceRuntime[] = [];
      // 根自身 + 子树（slot.children 与 entity.children）
      this.collectPassiveSourcesFromTree(slot.entity, slot.entity.instanceId, passiveSources, undefined, conditionRoots);
      for (const c of slot.children) {
        this.collectPassiveSourcesFromTree(c, slot.entity.instanceId, passiveSources, undefined, conditionRoots);
      }

      const starterBag = isStarter(edef)
        ? this.collectHostOnHitBag(slot.entity, [slot.children])
          .filter(e => !(e as any).condition || this.evaluateCondition((e as any).condition, conditionRoots))
        : [];

      if (isStarter(edef)) {
        const selfIsActive = getEffectiveValue(slot.entity, 'isActive') ?? edef.isActive;
        if (selfIsActive) {
          const starterTargetingMods = this._collectEntityTargetingMods(allChildren);
          collected.weapons.unshift({
            name: edef.name,
            actionTime: Number(getEffectiveValue(slot.entity, 'actionTime') ?? 0),
            damage: 0,
            staminaCost: Number(getEffectiveValue(slot.entity, 'staminaCost') ?? 0),
            ...this._resolveWeaponTargeting(starterTargetingMods, slot.entity, edef),
            ownerInstanceId: slot.entity.instanceId,
            onHitEffects: cloneOnHitEffects(starterBag),
          });
        }

        for (const w of collected.weapons) {
          if (w.ownerInstanceId === slot.entity.instanceId) continue;
          const local = w.onHitEffects || [];
          w.onHitEffects = [...cloneOnHitEffects(starterBag), ...local];
        }

        for (const w of collected.weapons) {
          entityOnHitEffects.set(w.ownerInstanceId, cloneOnHitEffects(w.onHitEffects || []));
        }
      }

      // 基础值不含被动列表（被动运行时施加）；启动端本体含实例 overrides（如工匠强化）
      const hp = Number(getEffectiveValue(slot.entity, 'hp') ?? edef.hp ?? 0);
      const maxStamina = Number(getEffectiveValue(slot.entity, 'maxStamina') ?? edef.maxStamina ?? 0);
      const totalStaminaRegen = Number(getEffectiveValue(slot.entity, 'staminaRegen') ?? edef.staminaRegen ?? 0);
      const totalHpRegen = Number(getEffectiveValue(slot.entity, 'hpRegen') ?? edef.hpRegen ?? 0);
      const effectiveMaxLoad = Number(getEffectiveValue(slot.entity, 'maxLoad') ?? edef.maxLoad ?? 0);
      const isOverloaded = collected.totalLoad > effectiveMaxLoad;

      units.push({
        instanceId: slot.entity.instanceId,
        entityId: edef.id,
        entityName: edef.name,
        totalHp: hp,
        currentHp: hp,
        totalStaminaRegen,
        maxStamina,
        currentStamina: maxStamina,
        staminaRegen: totalStaminaRegen,
        totalHpRegeneration: totalHpRegen,
        currentLoad: collected.totalLoad,
        maxLoad: effectiveMaxLoad,
        isOverloaded,
        slotIndex: slotIdx,
        isStarter: isStarter(edef),
        activeWeapons: collected.weapons,
        passiveSources,
        affixIds: [
          ...this.collectAffixIds(slot.entity),
          ...slot.children.flatMap(c => this.collectAffixIds(c)),
        ],
      });
    }

    // BD/开战快照只保留基础值；被动由 buildCombatRuntime 后 recomputePassiveBonuses 施加。
    // 禁止把被动结果写回 snapshot，否则开战会再叠一层（如 8+5 再 +5 → 18）。
    return { snapshots: units, onHitEffects: entityOnHitEffects };
  }

  // ---- 敌方 BD 生成（v3：产出 CombatUnitSnapshot[]） ----
  generateEnemyBD(): CombatUnitSnapshot[] {
    const r = this.state.round;
    const rand = seededRandom(this.state.seed + r * 777);
    const count = r === 1 ? 1 : r === 2 ? 2 : 3;

    const enemyTemplates = [
      { name: '重装步兵', hpBase: 25, maxStamina:60, staminaRegen:5, maxLoad:25, sortBy: '站位1' },
      { name: '哥布林战士', hpBase: 15, maxStamina:50, staminaRegen:8, maxLoad:15, sortBy: '从上往下' },
      { name: '哥布林弓手', hpBase: 12, maxStamina:55, staminaRegen:7, maxLoad:12, sortBy: '从下往上' },
      { name: '骷髅法师', hpBase: 10, maxStamina:70, staminaRegen:6, maxLoad:10, sortBy: '站位2' },
      { name: '暗影刺客', hpBase: 14, maxStamina:45, staminaRegen:9, maxLoad:12, sortBy: '从上往下' },
    ];

    const weaponTemplates = [
      { name: '生锈短剑', actionTime: 2000, damage: 3, staminaCost: 10, targetCount: 1 as const, targetCondition: { sortBy: '站位1', filterBy: ['敌人'] } },
      { name: '猎弓', actionTime: 2100, damage: 4, staminaCost: 12, targetCount: 1 as const, targetCondition: { sortBy: '从下往上', filterBy: ['敌人'] } },
      { name: '木盾', actionTime: 0, damage: 0, staminaCost: 0, targetCount: 1 as const, targetCondition: { sortBy: '从上往下', filterBy: ['敌人'] } },
      { name: '骨杖', actionTime: 2500, damage: 5, staminaCost: 15, targetCount: 1 as const, targetCondition: { sortBy: '站位3', filterBy: ['敌人'] } },
    ];

    const units: CombatUnitSnapshot[] = [];

    for (let i = 0; i < count; i++) {
      const t = enemyTemplates[Math.floor(rand() * enemyTemplates.length)];
      const mult = 1 + (r - 1) * 0.7;
      const hp = Math.floor(t.hpBase * mult * (0.8 + rand() * 0.4));

      const weapons: CombatUnitSnapshot['activeWeapons'] = [];
      if (rand() > 0.5) {
        const wt = weaponTemplates[Math.floor(rand() * weaponTemplates.length)];
        const wdmg = Math.floor(wt.damage * mult * (0.8 + rand() * 0.4));
        const amount = wdmg > 0 ? wdmg : wt.damage;
        weapons.push({
          ...wt,
          damage: 0,
          ownerInstanceId: `enemy_${i}`,
          onHitEffects: amount
            ? [{ displayName: '伤害', stat: 'hp', op: 'loss', params: { amount }, applyTo: ['target'] }]
            : [],
        });
      } else {
        const amount = Math.floor((2 + rand() * 3) * mult);
        weapons.push({
          name: '基础攻击',
          actionTime: 2000 + Math.floor(rand() * 1500),
          damage: 0,
          staminaCost: 8,
          targetCount: 1,
          targetCondition: { sortBy: t.sortBy, filterBy: ['敌人'] },
          ownerInstanceId: `enemy_${i}`,
          onHitEffects: [
            { displayName: '伤害', stat: 'hp', op: 'loss', params: { amount }, applyTo: ['target'] },
          ],
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
        slotIndex: i,
        isStarter: true,
        activeWeapons: weapons,
      });
    }

    return units;
  }

  /** 从 CombatUnitSnapshot 转换为运行时结构 */
  /** BD 面板静态预览：基础快照 + 被动重算（不写回快照） */
  previewBdRuntimes(slots: DeploySlot[]): CombatUnitRuntime[] {
    const { snapshots } = this.calculateCombatSnapshots(slots);
    const rts = buildCombatRuntime(snapshots);
    recomputePassiveBonuses(rts, [], () => 0, true);
    return rts;
  }

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

  /** 解析武器 targeting（filterBy 含阵营；遗留 targetFaction 并入；无阵营=空池） */
  private _resolveWeaponTargeting(
    modifiers: TargetingModifier[],
    item: ItemInstance,
    def: EntityDef,
  ): {
    targetCount: number | 'all';
    targetCondition: TargetCondition;
  } {
    let sortBy: string | null | undefined;
    let filterBy: unknown;
    let targetCount: unknown;
    let legacyOrder: string | null | undefined;
    let legacyPriority: number | null | undefined;
    let legacyFaction: string | null | undefined;

    for (const mod of modifiers) {
      if (mod.sortBy !== undefined) sortBy = mod.sortBy;
      if (mod.filterBy !== undefined) filterBy = mod.filterBy;
      if (mod.targetCount !== undefined) targetCount = mod.targetCount;
      if (mod.targetOrder !== undefined) legacyOrder = mod.targetOrder;
      if (mod.priorityTarget !== undefined) legacyPriority = mod.priorityTarget;
      if (mod.targetFaction !== undefined) legacyFaction = mod.targetFaction;
    }

    const ovTc = (item.overrides as any)?.targetCondition ?? def.targetCondition;
    if (sortBy === undefined) sortBy = ovTc?.sortBy;
    if (filterBy === undefined) filterBy = ovTc?.filterBy;
    if (targetCount === undefined) {
      targetCount = (item.overrides as any)?.targetCount ?? def.targetCount ?? ovTc?.targetCount;
    }
    if (legacyOrder === undefined) {
      legacyOrder = this._mergeTargetingField('targetOrder', [], item, def, null);
    }
    if (legacyPriority === undefined) {
      legacyPriority = this._mergeTargetingField('priorityTarget', [], item, def, null);
    }
    if (legacyFaction === undefined) {
      legacyFaction = this._mergeTargetingField('targetFaction', [], item, def, null);
    }

    const resolvedSort = resolveSortBy({
      sortBy: sortBy ?? null,
      targetOrder: legacyOrder ?? null,
      priorityTarget: legacyPriority ?? null,
    });
    const filters = mergeFiltersWithLegacyFaction(filterBy, legacyFaction);
    const count = normalizeTargetCount(targetCount);

    return {
      targetCount: count,
      targetCondition: {
        sortBy: resolvedSort,
        filterBy: filters,
        targetCount: count,
      },
    };
  }

  /** @deprecated 由 _resolveWeaponTargeting 替代 */
  private _mergeTargetCondition(
    modifiers: TargetingModifier[],
    item: ItemInstance,
    def: EntityDef,
  ): TargetCondition | undefined {
    return this._resolveWeaponTargeting(modifiers, item, def).targetCondition;
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
    opts?: { forceMainThread?: boolean; rng?: () => number },
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
      forceMainThread: opts?.forceMainThread,
      rng: opts?.rng,
      onTick: (combatTime, player, enemy) => {
        this.combatTime = combatTime;
        this.combatPlayerUnits = player;
        this.combatEnemyUnits = enemy;
      },
      isPaused,
      isCancelled,
    });
  }

  /** 应用胜利结算：胜奖入备用池（不立刻加现金） */
  private applyCombatVictoryRewards(): number {
    const goldReward = this.getBattleWinGold();
    this.addReserve(goldReward);
    this.recordGoldGained(goldReward);
    this.notify();
    return goldReward;
  }

  /** 记录本场战斗（不直接写盘；由 UI 写 battle_end 后 flush） */
  recordBattle(rec: BattleRecord) {
    if (this.combatSeed != null && rec.combatSeed == null) {
      rec.combatSeed = this.combatSeed;
    }
    this.state.battles.push(rec);
  }

  /** 匹配成功后写入开战快照字段（随后必须 flushSave） */
  beginBattlePending(opts: { enemyBd: DeploySlot[] | null; autoWin: boolean }) {
    this.combatPhase = 'battle_pending';
    this.pendingEnemyBd = opts.enemyBd
      ? JSON.parse(JSON.stringify(opts.enemyBd)) as DeploySlot[]
      : null;
    this.pendingAutoWin = opts.autoWin;
    this.combatSeed = (Date.now() ^ (Math.floor(Math.random() * 1e9))) >>> 0;
    if (this.combatSeed === 0) this.combatSeed = 1;
    this.combatRngVersion = COMBAT_RNG_VERSION;
    this.combatResultSummary = null;
    this.historySyncPending = false;
  }

  /** 战斗结束态：保留 pendingEnemyBd 供读档还原 UI */
  markBattleEnd(summary: { win: boolean; gold: number; autoWin: boolean }) {
    this.combatPhase = 'battle_end';
    this.combatResultSummary = { ...summary };
  }

  clearCombatSnapshot() {
    this.combatPhase = 'explore';
    this.pendingEnemyBd = null;
    this.pendingAutoWin = false;
    this.combatSeed = null;
    this.combatResultSummary = null;
    this.combatRngVersion = COMBAT_RNG_VERSION;
  }

  hasBattleRecordForRound(round: number = this.state.round): boolean {
    return this.state.battles.some(b => b.round === round);
  }

  getBattleRecordForRound(round: number = this.state.round): BattleRecord | null {
    const list = this.state.battles.filter(b => b.round === round);
    return list.length ? list[list.length - 1] : null;
  }

  /**
   * 读档恢复决策（实现约定 E）。
   * 先看本回合是否已有 battles，再看 combatPhase。
   */
  resolveCombatResume(): CombatResumeKind {
    if (this.isExplore()) {
      return 'explore';
    }
    // 偶数战斗回合
    if (this.hasBattleRecordForRound(this.state.round) || this.combatPhase === 'battle_end') {
      return 'end_ui';
    }
    if (this.combatPhase === 'battle_pending') {
      const rngOk = (this.combatRngVersion ?? COMBAT_RNG_VERSION) === COMBAT_RNG_VERSION;
      const hasSnapshot = this.pendingAutoWin || (this.pendingEnemyBd != null && this.combatSeed != null);
      if (rngOk && hasSnapshot && this.combatSeed != null) {
        return 'replay';
      }
      return 'rollback_explore';
    }
    // 缺省旧档：偶数无快照
    return 'rollback_explore';
  }

  /**
   * 正式战准备：先从对战池抽取敌方，再上传己方 BD。
   * （先抽后传，避免本局刚上传的 BD 被抽作对手）
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

    let enemySlots: DeploySlot[] | null = null;
    let autoWin = false;
    let opponentName: string | undefined;

    try {
      const { opponent } = await dataApi.getBattlePool(this.state.round);
      if (opponent && opponent.bd_json && Array.isArray(opponent.bd_json) && opponent.bd_json.length > 0) {
        enemySlots = opponent.bd_json as DeploySlot[];
        opponentName = opponent.username;
      } else {
        autoWin = true;
      }
      console.log('[prepareOfficialBattle] 抽取对手', {
        round: this.state.round,
        autoWin,
        opponent: opponentName,
        slots: enemySlots?.length ?? 0,
      });
    } catch (e) {
      console.error('[prepareOfficialBattle] 抽取对手失败', e);
      return {
        playerSlots, enemySlots: null, autoWin: false, networkError: true,
        errorMessage: (e as Error)?.message || '匹配失败，请检查网络后重试',
      };
    }

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

    return {
      playerSlots,
      enemySlots,
      autoWin,
      networkError: false,
      opponentName,
    };
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
    // 开战即重算被动，供 UI 首帧与 Simulator 共用（勿等 Simulator 构造）
    recomputePassiveBonuses(playerUnits, enemyUnits, undefined, true);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    // 0.0s 开战预处理日志由 Simulator.bootstrapAtZero 产出（勿再注入空洞「战斗开始」）

    await new Promise(r => setTimeout(r, 300));

    let seed = this.combatSeed ?? ((Date.now() ^ (Math.floor(Math.random() * 1e9))) >>> 0);
    if (!seed) seed = 1;
    if (this.combatSeed == null) this.combatSeed = seed;

    try {
      const result = await this._playWithSimulator(
        playerUnits, enemyUnits, playerOnHitEffects, enemyOnHitEffects, onEvent,
        isPaused, isCancelled, speed ?? (() => this.combatSpeed),
        { forceMainThread: true, rng: seededRandom(seed) },
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
        combatSeed: seed,
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
    recomputePassiveBonuses(playerUnits, enemyUnits, undefined, true);

    this.combatPlayerUnits = playerUnits;
    this.combatEnemyUnits = enemyUnits;

    // 0.0s 开战预处理日志由 Simulator.bootstrapAtZero 产出

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
      reserveGold: this.state.reserveGold,
      totalGoldGained: this.state.totalGoldGained,
      round: this.state.round,
      phase: this.state.phase,
      warehouse: this.state.warehouse,
      deploySlots: this.state.deploySlots,
      itemPool: this.state.itemPool,
      seed: this.state.seed,
      currentEvents: this.state.currentEvents,
      eventStatus: this.state.eventStatus,
      activeEventId: this.state.activeEventId,
      eventOffers: this.state.eventOffers,
      eventOfferPrices: this.state.eventOfferPrices,
      craftsmanSlot: this.state.craftsmanSlot,
      craftsmanReturn: this.state.craftsmanReturn,
      shopOffers: this.state.shopOffers,
      shopRefreshCount: this.state.shopRefreshCount,
      visitedEventMerchants: this.state.visitedEventMerchants,
      battles: this.state.battles,
      maxRound: this.state.maxRound,
      historyRunId: this.historyRunId,
      combatPhase: this.combatPhase,
      pendingEnemyBd: this.pendingEnemyBd,
      pendingAutoWin: this.pendingAutoWin,
      combatSeed: this.combatSeed,
      combatResultSummary: this.combatResultSummary,
      combatRngVersion: this.combatRngVersion,
      historySyncPending: this.historySyncPending,
      savedAt: new Date().toISOString(),
      saveVersion: 4,
    };
  }

  /** 组装历史归档 run 快照 */
  buildHistoryRunPayload(status: 'in_progress' | 'cleared'): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      status,
      maxRound: this.state.maxRound,
      gold: this.state.gold,
      totalGoldGained: this.state.totalGoldGained,
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
      await this.flushSave();
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
    this.state.gold = data.gold ?? 30;
    this.state.reserveGold = data.reserveGold ?? 0;
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
    // 旧档无字段时：按已记录战斗奖 + 可推断的探险发放回填（事件无法还原）
    if (typeof data.totalGoldGained === 'number') {
      this.state.totalGoldGained = data.totalGoldGained;
    } else {
      this.state.totalGoldGained = estimateTotalGoldGainedFallback(this.state.battles, round, this.state.maxRound);
    }
    this.historyRunId = typeof data.historyRunId === 'number' ? data.historyRunId : null;
    this.recomputeItemPool();

    this.state.shopOffers = Array.isArray(data.shopOffers) ? data.shopOffers : [];
    this.state.shopRefreshCount = data.shopRefreshCount ?? 0;
    this.state.eventStatus = data.eventStatus ?? 'pending';
    this.state.activeEventId = data.activeEventId ?? null;
    this.state.eventOffers = Array.isArray(data.eventOffers) ? data.eventOffers : [];
    this.state.eventOfferPrices = data.eventOfferPrices ?? {};
    this.state.craftsmanSlot = data.craftsmanSlot ?? null;
    this.state.craftsmanReturn = data.craftsmanReturn ?? null;

    // 战斗快照字段（saveVersion 4+）
    const phaseRaw = data.combatPhase;
    this.combatPhase =
      phaseRaw === 'battle_pending' || phaseRaw === 'battle_end' || phaseRaw === 'explore'
        ? phaseRaw
        : (this.isBattlePhase() ? 'battle_pending' : 'explore');
    this.pendingEnemyBd = Array.isArray(data.pendingEnemyBd) ? data.pendingEnemyBd : null;
    this.pendingAutoWin = !!data.pendingAutoWin;
    this.combatSeed = typeof data.combatSeed === 'number' ? data.combatSeed : null;
    this.combatResultSummary = data.combatResultSummary && typeof data.combatResultSummary === 'object'
      ? data.combatResultSummary
      : null;
    this.combatRngVersion = typeof data.combatRngVersion === 'number' ? data.combatRngVersion : COMBAT_RNG_VERSION;
    this.historySyncPending = !!data.historySyncPending;

    // 若已有本回合战报但 phase 仍 pending，校正为 end
    if (this.isBattlePhase() && this.hasBattleRecordForRound(this.state.round)) {
      this.combatPhase = 'battle_end';
      if (!this.combatResultSummary) {
        const rec = this.getBattleRecordForRound();
        if (rec) {
          this.combatResultSummary = {
            win: rec.result !== 'loss',
            gold: rec.rewardGold,
            autoWin: rec.result === 'auto_win',
          };
        }
      }
      if (!this.pendingEnemyBd && this.getBattleRecordForRound()?.enemyBd) {
        this.pendingEnemyBd = JSON.parse(JSON.stringify(this.getBattleRecordForRound()!.enemyBd));
      }
      this.pendingAutoWin = this.combatResultSummary?.autoWin ?? this.pendingAutoWin;
    }

    const legacyMerchantEvents = ['good_merchant', 'entity_merchant', 'affix_merchant', 'discount_merchant', 'lottery'];
    if (Array.isArray(data.currentEvents) && data.currentEvents.length > 0
      && !data.currentEvents.some((id: string) => legacyMerchantEvents.includes(id))) {
      this.state.currentEvents = data.currentEvents;
    } else if (this.isExplore()) {
      this.generateEvents();
      if (!this.state.shopOffers.length) this.rollShopOffers();
    } else {
      this.state.currentEvents = [];
    }
    if (this.isExplore() && !this.state.shopOffers.length) {
      this.rollShopOffers();
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

  private handleSaveError(e: unknown, rethrow: boolean) {
    if (e instanceof ApiError && e.status === 401) {
      this.onAuthExpired?.();
      if (rethrow) throw e;
      return;
    }
    if (!this.saveFailToasted) {
      this.saveFailToasted = true;
      this.onSaveError?.('自动存档失败，请稍后手动存档', e);
    }
    if (rethrow) throw e;
  }

  /** 探险提交型即时存（约定 A）；拖拽 suppress 时跳过 */
  requestExploreCommitSave() {
    if (this.suppressExploreSave) return;
    if (!this.isExplore() || this.combatPhase !== 'explore') return;
    this.requestSave({ reason: 'explore-commit' });
  }

  requestSave(_opts?: { reason?: string }) {
    this.saveQueue.request();
  }

  async flushSave(): Promise<void> {
    try {
      await this.saveQueue.flush();
      this.saveFailToasted = false;
    } catch (e) {
      this.handleSaveError(e, true);
    }
  }

  /** @deprecated 使用 requestSave / flushSave */
  async autoSave() {
    this.requestSave({ reason: 'legacy-auto' });
  }

  async manualSave() {
    await this.flushSave();
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
    } catch {
      return false;
    }
  }
}
