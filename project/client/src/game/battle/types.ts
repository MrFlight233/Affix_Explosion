// 战斗运行时类型（从 GameEngine 迁出，供 Simulator / Playback / Worker 共用）

import type { OnHitEffect, TargetCondition } from '../data';

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
  /** @deprecated 兼容字段；结算读 onHitEffects */
  damage: number;
  staminaCost: number;
  targetFaction?: string;
  targetCount?: number | 'all';
  targetCondition?: TargetCondition;
  ownerInstanceId: string;
  onHitEffects?: OnHitEffect[];
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
  isOverloaded: boolean;
  slotIndex: number;
  isStarter: boolean;
  weapons: CombatWeaponRuntime[];
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
  return units.map(u => ({
    instanceId: u.instanceId,
    entityId: u.entityId,
    entityName: u.entityName,
    totalHp: u.totalHp,
    currentHp: u.currentHp,
    maxStamina: u.maxStamina,
    currentStamina: u.currentStamina,
    staminaRegen: u.totalStaminaRegen,
    hpRegeneration: u.totalHpRegeneration,
    isOverloaded: u.isOverloaded,
    slotIndex: u.slotIndex ?? 0,
    isStarter: u.isStarter ?? false,
    weapons: u.activeWeapons.map(w => ({
      name: w.name,
      actionTime: w.actionTime,
      remainingTime: w.actionTime,
      damage: w.damage,
      staminaCost: w.staminaCost,
      targetFaction: w.targetFaction,
      targetCount: w.targetCount,
      targetCondition: w.targetCondition,
      ownerInstanceId: w.ownerInstanceId,
      onHitEffects: w.onHitEffects ? w.onHitEffects.map(e => ({ ...e, params: { ...e.params }, applyTo: e.applyTo ? [...e.applyTo] : undefined })) : [],
    })),
  }));
}
