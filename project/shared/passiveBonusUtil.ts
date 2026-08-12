// 被动加成：规范化、旧五列迁移、展示（与主动同构目标，无耐耗/耗时）

import type { TargetCondition } from './types';
import type { SubtreeCondition } from './types';
import { resolveEffectIdentityRaw } from './effectIdentityUtil';

export type PassiveStat = 'maxHp' | 'maxStamina' | 'maxLoad' | 'hpRegen' | 'staminaRegen';
export type PassiveOp = 'gain' | 'loss';

export interface PassiveEffect {
  displayName: string;
  stat: PassiveStat;
  op: PassiveOp;
  params: { amount: number };
  /** 可选：子树条件（满足后才生效） */
  condition?: SubtreeCondition;
}

export interface PassiveBonusConfig {
  hasPassiveBonuses: boolean;
  passiveEffects: PassiveEffect[];
  passiveTargetCondition: TargetCondition;
  passiveTargetCount: number | 'all';
}

export const PASSIVE_STATS = new Set<PassiveStat>([
  'maxHp', 'maxStamina', 'maxLoad', 'hpRegen', 'staminaRegen',
]);

const OP_SET = new Set<PassiveOp>(['gain', 'loss']);

export const DEFAULT_PASSIVE_TARGET: TargetCondition = {
  sortBy: 'random',
  filterBy: ['根实体'],
};

export const PASSIVE_STAT_LABEL: Record<PassiveStat, string> = {
  maxHp: 'HP上限',
  maxStamina: '耐力上限',
  maxLoad: '负重上限',
  hpRegen: '生命恢复',
  staminaRegen: '耐力恢复',
};

export function defaultPassiveDisplayName(stat: PassiveStat, op: PassiveOp): string {
  const gain: Record<PassiveStat, string> = {
    maxHp: '生命加成',
    maxStamina: '耐力加成',
    maxLoad: '负重加成',
    hpRegen: '生命恢复加成',
    staminaRegen: '耐力恢复加成',
  };
  const loss: Record<PassiveStat, string> = {
    maxHp: '削减生命上限',
    maxStamina: '削减耐力上限',
    maxLoad: '削减负重上限',
    hpRegen: '削减生命恢复',
    staminaRegen: '削减耐力恢复',
  };
  return (op === 'loss' ? loss : gain)[stat];
}

export function normalizePassiveEffect(raw: unknown): PassiveEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const stat = o.stat as PassiveStat;
  const op = (o.op as PassiveOp) || 'gain';
  if (!PASSIVE_STATS.has(stat) || !OP_SET.has(op)) return null;
  const params = (o.params && typeof o.params === 'object')
    ? o.params as { amount?: number; percent?: number }
    : {};
  // v1：忽略 percent，仅 amount
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount === 0) return null;
  let displayName = String(o.displayName || '').trim();
  const result: PassiveEffect = { displayName, stat, op, params: { amount: Math.abs(amount) } };
  // 子树条件透传
  if (o.condition && typeof o.condition === 'object' && !Array.isArray(o.condition)) {
    result.condition = o.condition as SubtreeCondition;
  }
  return result;
}

export function normalizePassiveEffects(raw: unknown): PassiveEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: PassiveEffect[] = [];
  for (const item of raw) {
    const n = normalizePassiveEffect(item);
    if (n) out.push(n);
  }
  return out;
}

export function normalizePassiveTargetCondition(raw: unknown): TargetCondition {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PASSIVE_TARGET, filterBy: [...DEFAULT_PASSIVE_TARGET.filterBy!] };
  const o = raw as Record<string, unknown>;
  const sortBy = (typeof o.sortBy === 'string' && o.sortBy ? o.sortBy : 'random') as TargetCondition['sortBy'];
  let filterBy: string[] = [];
  if (Array.isArray(o.filterBy)) {
    filterBy = o.filterBy.map(String).filter(Boolean);
  } else if (typeof o.filterBy === 'string' && o.filterBy) {
    filterBy = [o.filterBy];
  }
  return { sortBy, filterBy };
}

export function normalizePassiveTargetCount(raw: unknown): number | 'all' {
  if (raw === 'all' || raw === -1 || raw === '-1') return 'all';
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 1;
}

/** 旧五列 → passiveEffects；正数 gain，负数 loss */
export function migrateLegacyPassiveScalars(input: {
  hpBonus?: number;
  hpRegenerationBonus?: number;
  staminaBonus?: number;
  staminaRegenerationBonus?: number;
  loadBonus?: number;
}): PassiveEffect[] {
  const pairs: { stat: PassiveStat; value: number; label: string }[] = [
    { stat: 'maxHp', value: Number(input.hpBonus) || 0, label: '生命加成' },
    { stat: 'hpRegen', value: Number(input.hpRegenerationBonus) || 0, label: '生命恢复加成' },
    { stat: 'maxStamina', value: Number(input.staminaBonus) || 0, label: '耐力加成' },
    { stat: 'staminaRegen', value: Number(input.staminaRegenerationBonus) || 0, label: '耐力恢复加成' },
    { stat: 'maxLoad', value: Number(input.loadBonus) || 0, label: '负重加成' },
  ];
  const out: PassiveEffect[] = [];
  for (const p of pairs) {
    if (p.value === 0) continue;
    out.push({
      displayName: p.label,
      stat: p.stat,
      op: p.value < 0 ? 'loss' : 'gain',
      params: { amount: Math.abs(p.value) },
    });
  }
  return out;
}

/**
 * 读档归一：若已有 passiveEffects 用其；否则从旧五列迁移。
 * hasPassiveBonuses=false → 空效果。
 */
export function resolvePassiveBonusConfig(raw: {
  hasPassiveBonuses?: boolean;
  passiveEffects?: unknown;
  passiveTargetCondition?: unknown;
  passiveTargetCount?: unknown;
  hpBonus?: number;
  hpRegenerationBonus?: number;
  staminaBonus?: number;
  staminaRegenerationBonus?: number;
  loadBonus?: number;
}): PassiveBonusConfig {
  const has = raw.hasPassiveBonuses === true;
  if (!has) {
    return {
      hasPassiveBonuses: false,
      passiveEffects: [],
      passiveTargetCondition: normalizePassiveTargetCondition(DEFAULT_PASSIVE_TARGET),
      passiveTargetCount: 1,
    };
  }
  let effects = normalizePassiveEffects(raw.passiveEffects);
  if (effects.length === 0) {
    effects = migrateLegacyPassiveScalars(raw);
  }
  return {
    hasPassiveBonuses: true,
    passiveEffects: effects,
    passiveTargetCondition: normalizePassiveTargetCondition(
      raw.passiveTargetCondition ?? DEFAULT_PASSIVE_TARGET,
    ),
    passiveTargetCount: normalizePassiveTargetCount(raw.passiveTargetCount ?? 1),
  };
}

export function isRootOnlyPassiveTarget(tc: TargetCondition | undefined): boolean {
  const fb = tc?.filterBy || [];
  if (fb.length !== 1) return false;
  return fb[0] === '根实体';
}

export function formatPassiveEffectLine(e: PassiveEffect, ownerName?: string): string {
  const displayName = e.displayName || (ownerName ? resolveEffectIdentityRaw(e.displayName, undefined, ownerName).displayName : e.displayName);
  const sign = e.op === 'loss' ? '-' : '+';
  return `${displayName} ${PASSIVE_STAT_LABEL[e.stat]} ${sign}${e.params.amount}`;
}

export function resolvePassiveDisplayName(e: PassiveEffect, ownerName?: string): string {
  return resolveEffectIdentityRaw(e.displayName, undefined, ownerName).displayName;
}

export function resolvePassiveBuffKey(e: PassiveEffect, ownerName?: string): string {
  // 被动效果没有 buffKey 字段，但提供统一接口供 symmetry
  return resolveEffectIdentityRaw(e.displayName, undefined, ownerName).displayName;
}

/** 战斗侧：遍历被动效果列表，对空 displayName 回填来源名 */
export function stampPassiveEffectList(list: PassiveEffect[], ownerName: string): void {
  for (const e of list) {
    if (!e.displayName.trim()) {
      e.displayName = resolvePassiveDisplayName(e, ownerName);
    }
  }
}

export function clonePassiveEffects(list: PassiveEffect[]): PassiveEffect[] {
  return list.map(e => ({
    displayName: e.displayName,
    stat: e.stat,
    op: e.op,
    params: { amount: e.params.amount },
    condition: e.condition ? { ...e.condition } : undefined,
  }));
}
