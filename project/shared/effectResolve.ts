// 效果库引用 → 战斗用 OnHitEffect / PassiveEffect

import type { EffectBinding, EffectDef } from './effectDef';
import type { OnHitEffect } from './hitEffectUtil';
import { normalizeOnHitEffect } from './hitEffectUtil';
import type { PassiveEffect, PassiveOp, PassiveStat } from './passiveBonusUtil';
import { normalizePassiveEffect, PASSIVE_STATS } from './passiveBonusUtil';
import { resolveEffectIdentityRaw } from './effectIdentityUtil';

export type EffectCatalog = Map<string, EffectDef> | Record<string, EffectDef>;

function getDef(catalog: EffectCatalog, id: string): EffectDef | undefined {
  if (catalog instanceof Map) return catalog.get(id);
  return catalog[id];
}

function schemaAllows(def: EffectDef, key: string): boolean {
  const schema = def.paramSchema;
  if (!schema || schema.length === 0) return true;
  return schema.includes(key as never);
}

/**
 * 主动挂载 → OnHitEffect
 */
export function resolveActiveBinding(
  def: EffectDef,
  binding: EffectBinding,
  ownerName?: string,
): OnHitEffect | null {
  if (!def.allowActive) return null;
  const p = binding.params || {};
  const amount = schemaAllows(def, 'amount') && p.amount != null
    ? p.amount
    : def.defaultParams.amount;
  const percent = schemaAllows(def, 'percent') && p.percent != null
    ? p.percent
    : def.defaultParams.percent;
  const durationMs = schemaAllows(def, 'durationMs') && p.durationMs != null
    ? p.durationMs
    : def.defaultDurationMs;
  const tickIntervalMs = schemaAllows(def, 'tickIntervalMs') && p.tickIntervalMs != null
    ? p.tickIntervalMs
    : def.defaultTickIntervalMs;
  let displayName = def.defaultDisplayName || def.name;
  if (schemaAllows(def, 'displayName') && p.displayName != null && String(p.displayName).trim()) {
    displayName = String(p.displayName);
  }
  displayName = resolveEffectIdentityRaw(displayName, undefined, ownerName).displayName;

  const applyTo = (schemaAllows(def, 'applyTo') && binding.applyTo?.length)
    ? binding.applyTo
    : def.defaultApplyTo;

  const raw: OnHitEffect = {
    displayName,
    kind: def.kind,
    stat: def.stat as OnHitEffect['stat'],
    op: def.op as OnHitEffect['op'],
    params: {},
  };
  if (amount != null) raw.params.amount = amount;
  if (percent != null) raw.params.percent = percent;
  if (durationMs != null) raw.durationMs = durationMs;
  if (tickIntervalMs != null) raw.tickIntervalMs = tickIntervalMs;
  if (applyTo?.length) raw.applyTo = applyTo;
  if (binding.condition) raw.condition = binding.condition;

  return normalizeOnHitEffect(raw);
}

/**
 * 被动挂载 → PassiveEffect（仅 PassiveStat 白名单）
 */
export function resolvePassiveBinding(
  def: EffectDef,
  binding: EffectBinding,
  ownerName?: string,
): PassiveEffect | null {
  if (!def.allowPassive) return null;
  const stat = def.stat as PassiveStat;
  if (!PASSIVE_STATS.has(stat)) return null;
  const op = (def.op === 'loss' ? 'loss' : 'gain') as PassiveOp;
  const p = binding.params || {};
  const amount = schemaAllows(def, 'amount') && p.amount != null
    ? Math.abs(Number(p.amount))
    : Math.abs(Number(def.defaultParams.amount) || 0);
  if (!Number.isFinite(amount) || amount === 0) return null;

  let displayName = def.defaultDisplayName || def.name;
  if (schemaAllows(def, 'displayName') && p.displayName != null && String(p.displayName).trim()) {
    displayName = String(p.displayName);
  }
  displayName = resolveEffectIdentityRaw(displayName, undefined, ownerName).displayName;

  const raw: PassiveEffect = {
    displayName,
    stat,
    op,
    params: { amount },
  };
  if (binding.condition) raw.condition = binding.condition;
  return normalizePassiveEffect(raw);
}

export function resolveActiveBindings(
  bindings: EffectBinding[],
  catalog: EffectCatalog,
  ownerName?: string,
): OnHitEffect[] {
  const out: OnHitEffect[] = [];
  const sorted = [...bindings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const b of sorted) {
    const def = getDef(catalog, b.effectId);
    if (!def) continue;
    const resolved = resolveActiveBinding(def, b, ownerName);
    if (resolved) out.push(resolved);
  }
  return out;
}

export function resolvePassiveBindings(
  bindings: EffectBinding[],
  catalog: EffectCatalog,
  ownerName?: string,
): PassiveEffect[] {
  const out: PassiveEffect[] = [];
  const sorted = [...bindings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const b of sorted) {
    const def = getDef(catalog, b.effectId);
    if (!def) continue;
    const resolved = resolvePassiveBinding(def, b, ownerName);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * 持续同名合并：后写覆盖（与现持续轨道同名互抢一致的配置层提示）。
 * 解析后的列表仍按顺序交给引擎；本函数供展示去重可选使用。
 */
export function mergeResolvedDurationHints(effects: OnHitEffect[]): OnHitEffect[] {
  const instant: OnHitEffect[] = [];
  const byName = new Map<string, OnHitEffect>();
  for (const e of effects) {
    const isDur = e.kind === 'duration' || (e.durationMs ?? 0) > 0;
    if (!isDur) {
      instant.push(e);
      continue;
    }
    byName.set(e.displayName || '', e);
  }
  return [...instant, ...byName.values()];
}
