// 命中效果结算 — 即时 / 持续数值管道

import type { OnHitEffect, OnHitApplyTo, OnHitOp, OnHitStat } from '../data';
import {
  computeHitEffectValue,
  effectKind,
  isTickShell,
  isWeaponStat,
  normalizeOnHitEffect,
  opSymbol,
  resolveApplyTo,
  statLabel,
} from '../hitEffectUtil';
import { formatCombatEffectLine } from '../activeActionDisplay';
import {
  attachOrRefreshDuration,
  needsWeaponScope,
  resolveWeaponIndices,
  weaponsForIndices,
} from './durations';
import type { CombatEvent, CombatUnitRuntime, CombatWeaponRuntime } from './types';
import { round6 } from './types';

export interface HitResolveContext {
  starter: CombatUnitRuntime;
  actionOwner: CombatUnitRuntime;
  target: CombatUnitRuntime;
  firingWeapon: CombatWeaponRuntime;
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
  /** 是否为持续挂载/刷新日志 */
  isDuration?: boolean;
}

/** 开火武器上的即时 remainingTime，需在 CD 重置后应用 */
export interface DeferredRemainingTimeOp {
  weapon: CombatWeaponRuntime;
  op: OnHitOp;
  value: number;
}

export interface ResolveOnHitResult {
  lines: HitEffectLineResult[];
  deferredRemaining: DeferredRemainingTimeOp[];
}

function unitForRole(role: OnHitApplyTo, ctx: HitResolveContext): CombatUnitRuntime {
  if (role === 'starter') return ctx.starter;
  if (role === 'actionOwner') return ctx.actionOwner;
  return ctx.target;
}

/** 解析 percent 分母 */
export function resolveEffectCap(
  stat: OnHitStat,
  unit: CombatUnitRuntime,
  weapon?: CombatWeaponRuntime,
): number {
  switch (stat) {
    case 'hp':
    case 'hpRegen':
    case 'maxHp':
      return unit.totalHp;
    case 'stamina':
    case 'staminaRegen':
    case 'maxStamina':
      return unit.maxStamina;
    case 'maxLoad':
    case 'burden':
      return unit.maxLoad;
    case 'actionTime':
      return weapon?.baseActionTime ?? 0;
    case 'staminaCost':
      return weapon?.baseStaminaCost ?? 0;
    case 'remainingTime':
      return weapon?.baseActionTime ?? 0;
    default:
      return 0;
  }
}

function applyInstantHpStamina(
  unit: CombatUnitRuntime,
  stat: 'hp' | 'stamina',
  op: OnHitOp,
  value: number,
): { before: number; after: number } {
  if (stat === 'hp') {
    const before = unit.currentHp;
    if (op === 'gain') {
      unit.currentHp = round6(Math.min(unit.currentHp + value, unit.totalHp));
    } else if (op === 'loss') {
      unit.currentHp = round6(unit.currentHp - value);
    } else {
      unit.currentHp = round6(Math.min(Math.max(value, 0), unit.totalHp));
    }
    return { before, after: unit.currentHp };
  }
  const before = unit.currentStamina;
  if (op === 'gain') {
    unit.currentStamina = round6(Math.min(unit.currentStamina + value, unit.maxStamina));
  } else if (op === 'loss') {
    unit.currentStamina = round6(Math.max(unit.currentStamina - value, 0));
  } else {
    unit.currentStamina = round6(Math.min(Math.max(value, 0), unit.maxStamina));
  }
  return { before, after: unit.currentStamina };
}

function applyRemainingTimeOp(
  weapon: CombatWeaponRuntime,
  op: OnHitOp,
  value: number,
): { before: number; after: number } {
  const before = weapon.remainingTime;
  if (op === 'gain') {
    weapon.remainingTime = round6(weapon.remainingTime + value);
  } else if (op === 'loss') {
    weapon.remainingTime = round6(Math.max(weapon.remainingTime - value, 0));
  } else {
    weapon.remainingTime = round6(Math.max(value, 0));
  }
  return { before, after: weapon.remainingTime };
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

function pushLine(
  lines: HitEffectLineResult[],
  partial: Omit<HitEffectLineResult, 'label'> & { label?: string },
): void {
  const line: HitEffectLineResult = { ...partial, label: '' };
  line.label = formatCombatEffectLine(line);
  lines.push(line);
}

/** 对单位打出一条即时（供 Tick 壳复用） */
export function applyInstantEffectToUnit(
  effect: Pick<OnHitEffect, 'displayName' | 'stat' | 'op' | 'params'>,
  unit: CombatUnitRuntime,
  role: OnHitApplyTo,
  weaponIndices: number[],
  firingWeapon: CombatWeaponRuntime | undefined,
  deferred: DeferredRemainingTimeOp[],
): HitEffectLineResult[] {
  const lines: HitEffectLineResult[] = [];
  const stat = effect.stat;
  const op = effect.op;

  if (stat === 'hp' || stat === 'stamina') {
    const cap = resolveEffectCap(stat, unit);
    const value = computeHitEffectValue(cap, effect.params);
    if (shouldSkip(effect as OnHitEffect, value) && op !== 'set') return lines;
    if (op === 'set') {
      const hasAmount = Object.prototype.hasOwnProperty.call(effect.params || {}, 'amount');
      const percent = effect.params?.percent ?? 0;
      if (!hasAmount && !percent) return lines;
    } else if (value <= 0) {
      return lines;
    }
    const { before, after } = applyInstantHpStamina(unit, stat, op, value);
    let targetHpDelta = 0;
    if (role === 'target' && stat === 'hp') {
      if (op === 'loss') targetHpDelta = value;
      else if (op === 'gain') targetHpDelta = -value;
    }
    pushLine(lines, {
      displayName: effect.displayName,
      stat,
      op,
      value,
      role,
      affectedName: unit.entityName,
      before,
      after,
      targetHpDelta,
    });
    return lines;
  }

  if (stat === 'remainingTime') {
    const weapons = weaponIndices.length
      ? weaponsForIndices(unit, weaponIndices)
      : unit.weapons;
    for (const w of weapons) {
      const cap = resolveEffectCap('remainingTime', unit, w);
      const value = computeHitEffectValue(cap, effect.params);
      if (shouldSkip(effect as OnHitEffect, value) && op !== 'set') continue;
      if (op !== 'set' && value <= 0) continue;

      const isFiring = firingWeapon && w === firingWeapon;
      if (isFiring) {
        deferred.push({ weapon: w, op, value });
        pushLine(lines, {
          displayName: effect.displayName,
          stat,
          op,
          value,
          role,
          affectedName: `${unit.entityName}/${w.name}`,
          before: w.remainingTime,
          after: w.remainingTime,
          targetHpDelta: 0,
        });
      } else {
        const { before, after } = applyRemainingTimeOp(w, op, value);
        pushLine(lines, {
          displayName: effect.displayName,
          stat,
          op,
          value,
          role,
          affectedName: `${unit.entityName}/${w.name}`,
          before,
          after,
          targetHpDelta: 0,
        });
      }
    }
  }
  return lines;
}

/** 应用延迟的开火武器倒计时 */
export function applyDeferredRemainingTime(ops: DeferredRemainingTimeOp[]): void {
  for (const { weapon, op, value } of ops) {
    applyRemainingTimeOp(weapon, op, value);
  }
}

/**
 * 按序结算武器最终 onHitEffects。
 * percent 相对属性上限 / 开战武器快照。
 */
export function resolveWeaponOnHitEffects(
  effects: OnHitEffect[] | undefined,
  ctx: HitResolveContext,
): ResolveOnHitResult {
  const lines: HitEffectLineResult[] = [];
  const deferredRemaining: DeferredRemainingTimeOp[] = [];
  if (!effects || effects.length === 0) return { lines, deferredRemaining };

  for (const raw of effects) {
    const effect = normalizeOnHitEffect(raw);
    if (!effect) continue;

    const roles = resolveApplyTo(effect);

    if (effectKind(effect) === 'duration') {
      const tick = isTickShell(effect);
      for (const role of roles) {
        const unit = unitForRole(role, ctx);
        const weaponIndices = needsWeaponScope(effect.stat)
          ? resolveWeaponIndices(
            unit,
            unit.weapons.includes(ctx.firingWeapon) ? ctx.firingWeapon : undefined,
            true,
          )
          : [];

        // 算死 value：武器类对每把武器可能不同 cap — 取首把或单位 cap
        let value = 0;
        if (isWeaponStat(effect.stat) && weaponIndices.length > 0) {
          const caps = weaponIndices.map(i => resolveEffectCap(effect.stat, unit, unit.weapons[i]));
          value = Math.max(...caps.map(c => computeHitEffectValue(c, effect.params)));
        } else {
          const w = weaponIndices.length ? unit.weapons[weaponIndices[0]] : undefined;
          value = computeHitEffectValue(resolveEffectCap(effect.stat, unit, w), effect.params);
        }
        if (effect.op !== 'set' && value <= 0) continue;

        const { isNew, duration } = attachOrRefreshDuration(unit, {
          buffKey: effect.buffKey!,
          displayName: effect.displayName,
          durationMs: effect.durationMs!,
          tickIntervalMs: effect.tickIntervalMs,
          isTickShell: tick,
          stat: effect.stat,
          op: effect.op as 'gain' | 'loss',
          value,
          weaponIndices,
        });

        pushLine(lines, {
          displayName: effect.displayName,
          stat: effect.stat,
          op: effect.op,
          value: duration.value,
          role,
          affectedName: unit.entityName,
          before: 0,
          after: duration.value,
          targetHpDelta: 0,
          isDuration: true,
        });
        // 修正持续日志
        lines[lines.length - 1].label = formatDurationLogLine(
          effect.displayName,
          unit.entityName,
          effect.stat,
          effect.op,
          duration.value,
          effect.durationMs!,
          isNew,
        );

        // Tick 壳：新挂载立即首跳
        if (tick && isNew) {
          const tickLines = applyInstantEffectToUnit(
            {
              displayName: effect.displayName,
              stat: effect.stat,
              op: effect.op,
              params: { amount: duration.value },
            },
            unit,
            role,
            weaponIndices,
            ctx.firingWeapon,
            deferredRemaining,
          );
          lines.push(...tickLines);
        }
      }
      continue;
    }

    // 即时
    for (const role of roles) {
      const unit = unitForRole(role, ctx);
      const weaponIndices = needsWeaponScope(effect.stat)
        ? resolveWeaponIndices(
          unit,
          unit.weapons.includes(ctx.firingWeapon) ? ctx.firingWeapon : undefined,
          true,
        )
        : [];

      if (effect.stat === 'hp' || effect.stat === 'stamina' || effect.stat === 'remainingTime') {
        const instantLines = applyInstantEffectToUnit(
          effect,
          unit,
          role,
          weaponIndices,
          ctx.firingWeapon,
          deferredRemaining,
        );
        lines.push(...instantLines);
      }
    }
  }

  return { lines, deferredRemaining };
}

function formatDurationLogLine(
  displayName: string,
  unitName: string,
  stat: OnHitStat,
  op: OnHitOp,
  value: number,
  durationMs: number,
  isNew: boolean,
): string {
  const sym = opSymbol(op);
  const st = statLabel(stat);
  const sec = (durationMs / 1000).toFixed(1);
  const verb = isNew ? '挂上' : '刷新';
  return `${displayName} ${unitName} ${verb} ${st} ${sym} ${value}  (${sec}s)`;
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
    firingWeapon: weapon,
  });
  return results.lines.map(r => r.label);
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
