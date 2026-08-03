// 命中效果结算 — 数值变化管道

import type { OnHitEffect, OnHitApplyTo, OnHitOp, OnHitStat } from '../data';
import {
  computeHitEffectValue,
  normalizeOnHitEffect,
  resolveApplyTo,
} from '../hitEffectUtil';
import { formatCombatEffectLine } from '../activeActionDisplay';
import type { CombatEvent, CombatUnitRuntime, CombatWeaponRuntime } from './types';
import { round6 } from './types';

export interface HitResolveContext {
  starter: CombatUnitRuntime;
  actionOwner: CombatUnitRuntime;
  target: CombatUnitRuntime;
}

export interface HitEffectLineResult {
  displayName: string;
  stat: OnHitStat;
  op: OnHitOp;
  value: number;
  role: OnHitApplyTo;
  affectedName: string;
  before: number;
  after: number;
  /** 已格式化战斗日志子行 */
  label: string;
  /** 对 target 的净 HP 变化（loss 为正伤害，gain 为负）；其它对象为 0 */
  targetHpDelta: number;
}

function unitForRole(role: OnHitApplyTo, ctx: HitResolveContext): CombatUnitRuntime {
  if (role === 'starter') return ctx.starter;
  if (role === 'actionOwner') return ctx.actionOwner;
  return ctx.target;
}

function applyStatOp(
  unit: CombatUnitRuntime,
  stat: 'hp' | 'stamina',
  op: OnHitOp,
  value: number,
): { before: number; after: number; absDelta: number } {
  if (stat === 'hp') {
    const before = unit.currentHp;
    if (op === 'gain') {
      unit.currentHp = round6(Math.min(unit.currentHp + value, unit.totalHp));
    } else if (op === 'loss') {
      unit.currentHp = round6(unit.currentHp - value);
    } else {
      unit.currentHp = round6(Math.min(Math.max(value, 0), unit.totalHp));
    }
    return { before, after: unit.currentHp, absDelta: Math.abs(unit.currentHp - before) };
  }
  const before = unit.currentStamina;
  if (op === 'gain') {
    unit.currentStamina = round6(Math.min(unit.currentStamina + value, unit.maxStamina));
  } else if (op === 'loss') {
    unit.currentStamina = round6(Math.max(unit.currentStamina - value, 0));
  } else {
    unit.currentStamina = round6(Math.min(Math.max(value, 0), unit.maxStamina));
  }
  return { before, after: unit.currentStamina, absDelta: Math.abs(unit.currentStamina - before) };
}

function shouldSkip(effect: OnHitEffect, value: number): boolean {
  if (effect.op === 'set') {
    const hasAmount = Object.prototype.hasOwnProperty.call(effect.params || {}, 'amount');
    const percent = effect.params?.percent ?? 0;
    if (!hasAmount && !percent) return true;
    return false;
  }
  return value <= 0;
}

/**
 * 按序结算武器最终 onHitEffects。
 * hitMagnitude 初值 0；对 target 的 hp 成功结算后更新为实际 |ΔHP|。
 */
export function resolveWeaponOnHitEffects(
  effects: OnHitEffect[] | undefined,
  ctx: HitResolveContext,
): HitEffectLineResult[] {
  const lines: HitEffectLineResult[] = [];
  if (!effects || effects.length === 0) return lines;

  let hitMagnitude = 0;

  for (const raw of effects) {
    const effect = normalizeOnHitEffect(raw);
    if (!effect) continue;

    const hasAmount = Object.prototype.hasOwnProperty.call(effect.params || {}, 'amount');
    const percent = effect.params?.percent ?? 0;
    if (effect.op === 'set' && !hasAmount && !percent) continue;

    const value = computeHitEffectValue(hitMagnitude, effect.params);
    if (shouldSkip(effect, value)) continue;

    const roles = resolveApplyTo(effect);
    for (const role of roles) {
      const unit = unitForRole(role, ctx);
      const { before, after, absDelta } = applyStatOp(unit, effect.stat, effect.op, value);

      if (effect.stat === 'hp' && absDelta > 0) {
        if (role === 'target') {
          hitMagnitude = absDelta;
        } else if (hitMagnitude === 0) {
          hitMagnitude = absDelta;
        }
      }

      let targetHpDelta = 0;
      if (role === 'target' && effect.stat === 'hp') {
        if (effect.op === 'loss') targetHpDelta = value;
        else if (effect.op === 'gain') targetHpDelta = -value;
      }

      const line: HitEffectLineResult = {
        displayName: effect.displayName,
        stat: effect.stat,
        op: effect.op,
        value,
        role,
        affectedName: unit.entityName,
        before,
        after,
        label: '',
        targetHpDelta,
      };
      line.label = formatCombatEffectLine(line);
      lines.push(line);
    }
  }

  return lines;
}

/** @deprecated 兼容旧 Map API：改为读 weapon.onHitEffects */
export function resolveOnHitEffects(
  weapon: CombatWeaponRuntime,
  starter: CombatUnitRuntime,
  target: CombatUnitRuntime,
  _damage: number,
  onHitEffects: Map<string, OnHitEffect[]>,
  actionOwner?: CombatUnitRuntime,
): string[] {
  const effects = weapon.onHitEffects?.length
    ? weapon.onHitEffects
    : (onHitEffects.get(weapon.ownerInstanceId) || []);
  const results = resolveWeaponOnHitEffects(effects, {
    starter,
    actionOwner: actionOwner || starter,
    target,
  });
  return results.map(r => r.label);
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
