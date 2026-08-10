// 战斗运行时类型（从 GameEngine 迁出，供 Simulator / Playback / Worker 共用）

import type { OnHitEffect, OnHitOp, OnHitStat, TargetCondition } from '../data';
import { cloneOnHitEffects } from '../hitEffectUtil';
import type { PassiveEffect } from '../passiveBonusUtil';

export interface PassiveSourceRuntime {
  ownerItemInstanceId?: string;
  ownerName?: string;
  effects: PassiveEffect[];
  targetCondition: TargetCondition;
  targetCount: number | 'all';
}

export interface PassiveModBag {
  maxHp: number;
  maxStamina: number;
  maxLoad: number;
  hpRegen: number;
  staminaRegen: number;
}

export function emptyPassiveMods(): PassiveModBag {
  return { maxHp: 0, maxStamina: 0, maxLoad: 0, hpRegen: 0, staminaRegen: 0 };
}

/** 6 位小数精度取整 — 用于所有 HP/耐力/浮点属性计算 */
export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export const TICK_MS = 100;
export const MAX_COMBAT_TIME = 120000;
export const PENALTY_START_MS = 60000;

export interface CombatUnitSnapshot {
  instanceId: string;
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
  /** 第一层站位下标（0-based） */
  slotIndex: number;
  /** 是否启动端（含 starter 词条） */
  isStarter: boolean;
  activeWeapons: {
    name: string;
    actionTime: number;
    /** @deprecated 兼容；伤害来自 onHitEffects */
    damage: number;
    staminaCost: number;
    /** @deprecated 读档兼容；运行时以 filterBy 阵营为准 */
    targetFaction?: string;
    targetCount?: number | 'all';
    targetCondition?: TargetCondition;
    ownerInstanceId: string;
    /** 合并后的最终命中效果列表 */
    onHitEffects?: OnHitEffect[];
  }[];
  /** 归属于本第一层实体的被动源（子树聚合） */
  passiveSources?: PassiveSourceRuntime[];
}

export interface OnHitContext {
  starter: CombatUnitRuntime;
  actionOwnerId: string;
  target: CombatUnitRuntime;
  damage: number;
}

export interface CombatWeaponRuntime {
  name: string;
  actionTime: number;
  remainingTime: number;
  /** 开战快照：percent 分母与底盘还原基准 */
  baseActionTime: number;
  baseStaminaCost: number;
  /** @deprecated 兼容字段；结算读 onHitEffects */
  damage: number;
  staminaCost: number;
  targetFaction?: string;
  targetCount?: number | 'all';
  targetCondition?: TargetCondition;
  ownerInstanceId: string;
  onHitEffects?: OnHitEffect[];
}

/** 单位身上的持续效果实例 */
export interface ActiveDuration {
  buffKey: string;
  displayName: string;
  remainingMs: number;
  /** Tick 壳间隔；无则为底盘修饰 */
  tickIntervalMs?: number;
  /** 距下次 tick 的剩余毫秒；首跳后设为 interval */
  msUntilNextTick?: number;
  isTickShell: boolean;
  stat: OnHitStat;
  op: Exclude<OnHitOp, 'set'>;
  /** 挂上时算死的量 */
  value: number;
  /** 武器类：作用武器下标列表；空=单位池属性 */
  weaponIndices: number[];
}

export interface CombatUnitRuntime {
  instanceId: string;
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
  hpRegeneration: number;
  currentLoad: number;
  maxLoad: number;
  /** 重压（持续效果聚合） */
  burden: number;
  isOverloaded: boolean;
  /** 开战底盘快照 */
  baseTotalHp: number;
  baseMaxStamina: number;
  baseStaminaRegen: number;
  baseHpRegeneration: number;
  baseMaxLoad: number;
  slotIndex: number;
  isStarter: boolean;
  weapons: CombatWeaponRuntime[];
  durations: ActiveDuration[];
  /** 子树聚合的被动源；来源=本单位 */
  passiveSources: PassiveSourceRuntime[];
  /** 本 tick 被动修饰合计（全量重算写入） */
  passiveMods: PassiveModBag;
  /** 上次 chassis 重算时的 totalHp，用于检测上限增量 */
  _prevTotalHp: number;
  /** 上次 chassis 重算时的 maxStamina，用于检测上限增量 */
  _prevMaxStamina: number;
}

export interface CombatEvent {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  damage: number;
  targetHpAfter: number;
  targetMaxHp: number;
  /** 已格式化的效果子行（或击杀/特殊标记） */
  effects: string[];
  targetingLabel?: string;
}

export type PlaybackSpeed = 1 | 2 | 4 | 'max';

export interface BattleInitPayload {
  playerUnits: CombatUnitRuntime[];
  enemyUnits: CombatUnitRuntime[];
  playerOnHitEffects: Array<[string, OnHitEffect[]]>;
  enemyOnHitEffects: Array<[string, OnHitEffect[]]>;
  seed?: number;
}

export function buildCombatRuntime(units: CombatUnitSnapshot[]): CombatUnitRuntime[] {
  return units.map(u => {
    const weapons: CombatWeaponRuntime[] = u.activeWeapons.map(w => ({
      name: w.name,
      actionTime: w.actionTime,
      remainingTime: w.actionTime,
      baseActionTime: w.actionTime,
      baseStaminaCost: w.staminaCost,
      damage: w.damage,
      staminaCost: w.staminaCost,
      targetFaction: w.targetFaction,
      targetCount: w.targetCount,
      targetCondition: w.targetCondition,
      ownerInstanceId: w.ownerInstanceId,
      onHitEffects: w.onHitEffects ? cloneOnHitEffects(w.onHitEffects) : [],
    }));
    const overloaded = u.currentLoad + 0 > u.maxLoad;
    return {
      instanceId: u.instanceId,
      entityId: u.entityId,
      entityName: u.entityName,
      totalHp: u.totalHp,
      currentHp: u.currentHp,
      maxStamina: u.maxStamina,
      currentStamina: u.currentStamina,
      staminaRegen: u.totalStaminaRegen,
      hpRegeneration: u.totalHpRegeneration,
      currentLoad: u.currentLoad,
      maxLoad: u.maxLoad,
      burden: 0,
      isOverloaded: u.isOverloaded || overloaded,
      baseTotalHp: u.totalHp,
      baseMaxStamina: u.maxStamina,
      baseStaminaRegen: u.totalStaminaRegen,
      baseHpRegeneration: u.totalHpRegeneration,
      baseMaxLoad: u.maxLoad,
      slotIndex: u.slotIndex ?? 0,
      isStarter: u.isStarter ?? false,
      weapons,
      durations: [],
      passiveSources: (u.passiveSources || []).map(s => ({
        ownerItemInstanceId: s.ownerItemInstanceId,
        effects: s.effects.map(e => ({ ...e, params: { ...e.params } })),
        targetCondition: {
          sortBy: s.targetCondition?.sortBy || 'random',
          filterBy: [...(s.targetCondition?.filterBy || [])],
        },
        targetCount: s.targetCount,
      })),
      passiveMods: emptyPassiveMods(),
      _prevTotalHp: u.totalHp,
      _prevMaxStamina: u.maxStamina,
    };
  });
}
