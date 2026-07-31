// 命中效果结算

import type { OnHitEffect } from '../data';
import type { CombatEvent, CombatUnitRuntime, CombatWeaponRuntime, OnHitContext } from './types';
import { round6 } from './types';

export function resolveOnHitEffects(
  weapon: CombatWeaponRuntime,
  starter: CombatUnitRuntime,
  target: CombatUnitRuntime,
  damage: number,
  onHitEffects: Map<string, OnHitEffect[]>,
): string[] {
  const labels: string[] = [];
  if (damage <= 0) return labels;

  const effects = onHitEffects.get(weapon.ownerInstanceId);
  if (!effects || effects.length === 0) return labels;

  const ctx: OnHitContext = {
    starter,
    actionOwnerId: weapon.ownerInstanceId,
    target,
    damage,
  };

  for (const effect of effects) {
    const label = executeOnHitEffect(effect, ctx);
    if (label) labels.push(label);
  }

  return labels;
}

export function executeOnHitEffect(
  effect: OnHitEffect,
  ctx: OnHitContext,
): string | null {
  switch (effect.type) {
    case 'life_steal': {
      const pct = effect.params.percent ?? 0;
      const amt = effect.params.amount ?? 0;
      const heal = Math.round(ctx.damage * pct / 100) + amt;
      if (heal <= 0) return null;
      ctx.starter.currentHp = round6(Math.min(ctx.starter.currentHp + heal, ctx.starter.totalHp));
      return `吸血+${heal}`;
    }
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

/** Worker 传输：Map → 可结构化克隆的 pairs */
export function onHitMapToPairs(map: Map<string, OnHitEffect[]>): [string, OnHitEffect[]][] {
  return Array.from(map.entries());
}

/** Worker 传输：pairs → Map */
export function onHitPairsToMap(pairs: [string, OnHitEffect[]][] | undefined): Map<string, OnHitEffect[]> {
  return new Map(pairs ?? []);
}

/** 供测试：序列化事件关键字段做 hash 比对 */
export function eventFingerprint(e: CombatEvent): string {
  return [
    e.time, e.actorName, e.weaponName, e.targetName,
    e.damage, e.targetHpAfter, e.targetMaxHp,
    (e.effects || []).join('|'), e.targetingLabel || '',
  ].join('\0');
}
