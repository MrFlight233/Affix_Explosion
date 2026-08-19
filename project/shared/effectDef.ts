// 效果库：配方、通道、挂载引用（与实体/词条同级目录资产）

import type { TargetCondition } from './types';
import type { SubtreeCondition } from './types';
import type { OnHitApplyTo, OnHitKind, OnHitOp, OnHitStat } from './hitEffectUtil';
import type { PassiveOp, PassiveStat } from './passiveBonusUtil';

export type EffectStat = OnHitStat | PassiveStat;
export type EffectOp = OnHitOp | PassiveOp;

export interface EffectDef {
  id: string;
  name: string;
  description?: string;
  allowActive: boolean;
  allowPassive: boolean;
  kind: OnHitKind;
  stat: EffectStat;
  op: EffectOp;
  defaultParams: { amount?: number; percent?: number };
  defaultDurationMs?: number;
  defaultTickIntervalMs?: number;
  defaultDisplayName?: string;
  defaultApplyTo?: OnHitApplyTo[];
  /** 挂载允许覆写的字段 */
  paramSchema?: Array<
    'amount' | 'percent' | 'durationMs' | 'tickIntervalMs' | 'displayName' | 'applyTo'
  >;
  category?: string;
}

export interface EffectBinding {
  effectId: string;
  params?: Partial<{
    amount: number;
    percent: number;
    durationMs: number;
    tickIntervalMs: number;
    displayName: string;
  }>;
  applyTo?: OnHitApplyTo[];
  condition?: SubtreeCondition;
  order?: number;
}

export interface ActiveChannel {
  /** 对应 isActive；缺省时由宿主 isActive 推导 */
  enabled?: boolean;
  actionTime?: number;
  staminaCost?: number;
  targetCondition?: TargetCondition;
  targetCount?: number | 'all' | null;
  effectBindings: EffectBinding[];
}

export interface PassiveChannel {
  /** 被动总开关（原 hasPassiveBonuses） */
  enabled: boolean;
  targetCondition?: TargetCondition;
  targetCount?: number | 'all' | null;
  effectBindings: EffectBinding[];
}

export const DEFAULT_ACTIVE_PARAM_SCHEMA: NonNullable<EffectDef['paramSchema']> = [
  'amount', 'percent', 'durationMs', 'tickIntervalMs', 'displayName', 'applyTo',
];

export const DEFAULT_PASSIVE_PARAM_SCHEMA: NonNullable<EffectDef['paramSchema']> = [
  'amount', 'displayName',
];

export function emptyActiveChannel(): ActiveChannel {
  return { effectBindings: [] };
}

export function emptyPassiveChannel(enabled = false): PassiveChannel {
  return { enabled, effectBindings: [] };
}

export function normalizeEffectDef(raw: unknown): EffectDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const name = String(o.name || '').trim();
  if (!id || !name) return null;
  const kind = (o.kind === 'duration' ? 'duration' : 'instant') as OnHitKind;
  const stat = String(o.stat || '') as EffectStat;
  const op = (o.op as EffectOp) || 'gain';
  if (!stat) return null;
  const params = (o.defaultParams && typeof o.defaultParams === 'object')
    ? o.defaultParams as { amount?: number; percent?: number }
    : {};
  const allowActive = o.allowActive !== false && o.allowActive !== 0;
  const allowPassive = o.allowPassive === true || o.allowPassive === 1;
  // 瞬间默认仅主动；若显式写了 allowPassive 则尊重
  let finalAllowActive = allowActive;
  let finalAllowPassive = allowPassive;
  if (o.allowActive === undefined && o.allowPassive === undefined) {
    finalAllowActive = true;
    finalAllowPassive = kind === 'duration';
  }
  const def: EffectDef = {
    id,
    name,
    description: o.description != null ? String(o.description) : undefined,
    allowActive: finalAllowActive,
    allowPassive: finalAllowPassive,
    kind,
    stat,
    op,
    defaultParams: {
      amount: params.amount != null ? Number(params.amount) : undefined,
      percent: params.percent != null ? Number(params.percent) : undefined,
    },
    category: o.category != null ? String(o.category) : undefined,
  };
  if (o.defaultDurationMs != null) def.defaultDurationMs = Number(o.defaultDurationMs) || undefined;
  if (o.defaultTickIntervalMs != null) def.defaultTickIntervalMs = Number(o.defaultTickIntervalMs) || undefined;
  if (o.defaultDisplayName != null) def.defaultDisplayName = String(o.defaultDisplayName);
  if (Array.isArray(o.defaultApplyTo)) {
    def.defaultApplyTo = o.defaultApplyTo.map(String) as OnHitApplyTo[];
  }
  if (Array.isArray(o.paramSchema)) {
    def.paramSchema = o.paramSchema.map(String) as EffectDef['paramSchema'];
  } else {
    def.paramSchema = finalAllowPassive && !finalAllowActive
      ? [...DEFAULT_PASSIVE_PARAM_SCHEMA]
      : [...DEFAULT_ACTIVE_PARAM_SCHEMA];
  }
  return def;
}

export function normalizeEffectBinding(raw: unknown): EffectBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const effectId = String(o.effectId || '').trim();
  if (!effectId) return null;
  const binding: EffectBinding = { effectId };
  if (o.params && typeof o.params === 'object') {
    const p = o.params as Record<string, unknown>;
    binding.params = {};
    if (p.amount != null && Number.isFinite(Number(p.amount))) binding.params.amount = Number(p.amount);
    if (p.percent != null && Number.isFinite(Number(p.percent))) binding.params.percent = Number(p.percent);
    if (p.durationMs != null && Number.isFinite(Number(p.durationMs))) binding.params.durationMs = Number(p.durationMs);
    if (p.tickIntervalMs != null && Number.isFinite(Number(p.tickIntervalMs))) binding.params.tickIntervalMs = Number(p.tickIntervalMs);
    if (p.displayName != null) binding.params.displayName = String(p.displayName);
  }
  if (Array.isArray(o.applyTo)) binding.applyTo = o.applyTo.map(String) as OnHitApplyTo[];
  if (o.condition && typeof o.condition === 'object') binding.condition = o.condition as SubtreeCondition;
  if (o.order != null && Number.isFinite(Number(o.order))) binding.order = Number(o.order);
  return binding;
}

export function normalizeActiveChannel(raw: unknown): ActiveChannel {
  if (!raw || typeof raw !== 'object') return emptyActiveChannel();
  const o = raw as Record<string, unknown>;
  const bindings = Array.isArray(o.effectBindings)
    ? o.effectBindings.map(normalizeEffectBinding).filter((b): b is EffectBinding => !!b)
    : [];
  bindings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ch: ActiveChannel = { effectBindings: bindings };
  if (o.enabled != null) ch.enabled = o.enabled === true || o.enabled === 1;
  if (o.actionTime != null) ch.actionTime = Number(o.actionTime) || 0;
  if (o.staminaCost != null) ch.staminaCost = Number(o.staminaCost) || 0;
  if (o.targetCondition && typeof o.targetCondition === 'object') {
    ch.targetCondition = o.targetCondition as TargetCondition;
  }
  if (o.targetCount === 'all' || o.targetCount === -1) ch.targetCount = 'all';
  else if (o.targetCount != null) ch.targetCount = Number(o.targetCount) || null;
  return ch;
}

export function normalizePassiveChannel(raw: unknown): PassiveChannel {
  if (!raw || typeof raw !== 'object') {
    return emptyPassiveChannel(false);
  }
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true || o.enabled === 1;
  const bindings = Array.isArray(o.effectBindings)
    ? o.effectBindings.map(normalizeEffectBinding).filter((b): b is EffectBinding => !!b)
    : [];
  bindings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ch: PassiveChannel = { enabled, effectBindings: bindings };
  if (o.targetCondition && typeof o.targetCondition === 'object') {
    ch.targetCondition = o.targetCondition as TargetCondition;
  }
  if (o.targetCount === 'all' || o.targetCount === -1) ch.targetCount = 'all';
  else if (o.targetCount != null) ch.targetCount = Number(o.targetCount) || null;
  return ch;
}

/** 从签名生成可读倾向的效果 id */
export function suggestEffectId(parts: {
  kind: string;
  stat: string;
  op: string;
  amount?: number;
  durationMs?: number;
  tickIntervalMs?: number;
  passive?: boolean;
}): string {
  const bits = [
    parts.passive ? 'p' : 'a',
    parts.kind,
    parts.stat,
    parts.op,
  ];
  if (parts.amount != null) bits.push(String(Math.abs(parts.amount)));
  if (parts.durationMs) bits.push(`d${parts.durationMs}`);
  if (parts.tickIntervalMs) bits.push(`t${parts.tickIntervalMs}`);
  return bits.join('_').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}
