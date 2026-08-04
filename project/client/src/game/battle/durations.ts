// 持续效果：挂载、刷新、底盘重算、tick、到期、死亡清理

import type { OnHitOp, OnHitStat } from '../data';
import { isChassisStat, isWeaponStat } from '../hitEffectUtil';
import type { ActiveDuration, CombatUnitRuntime, CombatWeaponRuntime } from './types';
import { round6, TICK_MS } from './types';

export interface DurationAttachInput {
  buffKey: string;
  displayName: string;
  durationMs: number;
  tickIntervalMs?: number;
  isTickShell: boolean;
  stat: OnHitStat;
  op: Exclude<OnHitOp, 'set'>;
  value: number;
  /** 武器下标；空表示单位属性 */
  weaponIndices: number[];
}

export interface TickFireRequest {
  unit: CombatUnitRuntime;
  duration: ActiveDuration;
}

/** 按底盘持续重算单位有效属性 */
export function recomputeChassis(unit: CombatUnitRuntime): void {
  let dMaxHp = 0;
  let dMaxSta = 0;
  let dMaxLoad = 0;
  let dHpRegen = 0;
  let dStaRegen = 0;
  let dBurden = 0;

  const weaponDeltaAt = new Map<number, number>();
  const weaponDeltaCost = new Map<number, number>();

  for (const d of unit.durations) {
    if (d.isTickShell) continue;
    if (!isChassisStat(d.stat)) continue;
    const signed = d.op === 'gain' ? d.value : -d.value;
    switch (d.stat) {
      case 'maxHp': dMaxHp += signed; break;
      case 'maxStamina': dMaxSta += signed; break;
      case 'maxLoad': dMaxLoad += signed; break;
      case 'hpRegen': dHpRegen += signed; break;
      case 'staminaRegen': dStaRegen += signed; break;
      case 'burden': dBurden += signed; break;
      case 'actionTime':
        for (const idx of d.weaponIndices) {
          weaponDeltaAt.set(idx, (weaponDeltaAt.get(idx) || 0) + signed);
        }
        break;
      case 'staminaCost':
        for (const idx of d.weaponIndices) {
          weaponDeltaCost.set(idx, (weaponDeltaCost.get(idx) || 0) + signed);
        }
        break;
      default:
        break;
    }
  }

  unit.totalHp = round6(Math.max(1, unit.baseTotalHp + dMaxHp));
  unit.currentHp = round6(Math.min(unit.currentHp, unit.totalHp));
  unit.maxStamina = round6(Math.max(1, unit.baseMaxStamina + dMaxSta));
  unit.currentStamina = round6(Math.min(Math.max(unit.currentStamina, 0), unit.maxStamina));
  unit.maxLoad = round6(Math.max(0, unit.baseMaxLoad + dMaxLoad));
  unit.hpRegeneration = round6(Math.max(0, unit.baseHpRegeneration + dHpRegen));
  unit.staminaRegen = round6(Math.max(0, unit.baseStaminaRegen + dStaRegen));
  unit.burden = round6(Math.max(0, dBurden));
  unit.isOverloaded = unit.currentLoad + unit.burden > unit.maxLoad;

  unit.weapons.forEach((w, idx) => {
    w.actionTime = round6(Math.max(0, w.baseActionTime + (weaponDeltaAt.get(idx) || 0)));
    w.staminaCost = round6(Math.max(0, w.baseStaminaCost + (weaponDeltaCost.get(idx) || 0)));
  });
}

/**
 * 挂上或刷新持续。同键：满时长 + 数值 max；Tick 不重跳、不重置间隔。
 * 返回是否为新挂载（true=新挂或首挂，需立即首跳）。
 */
export function attachOrRefreshDuration(
  unit: CombatUnitRuntime,
  input: DurationAttachInput,
): { isNew: boolean; duration: ActiveDuration } {
  const existing = unit.durations.find(d => d.buffKey === input.buffKey);
  if (existing) {
    existing.remainingMs = input.durationMs;
    existing.value = Math.max(existing.value, input.value);
    existing.displayName = input.displayName;
    existing.stat = input.stat;
    existing.op = input.op;
    existing.weaponIndices = [...input.weaponIndices];
    // Tick：不重置 msUntilNextTick、不重跳
    if (!existing.isTickShell) {
      recomputeChassis(unit);
    }
    return { isNew: false, duration: existing };
  }

  const duration: ActiveDuration = {
    buffKey: input.buffKey,
    displayName: input.displayName,
    remainingMs: input.durationMs,
    tickIntervalMs: input.tickIntervalMs,
    msUntilNextTick: input.isTickShell ? (input.tickIntervalMs || 0) : undefined,
    isTickShell: input.isTickShell,
    stat: input.stat,
    op: input.op,
    value: input.value,
    weaponIndices: [...input.weaponIndices],
  };
  unit.durations.push(duration);
  if (!duration.isTickShell) {
    recomputeChassis(unit);
  }
  return { isNew: true, duration };
}

/** 推进持续：减寿命、收集到期与应开火的 tick；返回需打出的 tick */
export function advanceDurations(
  unit: CombatUnitRuntime,
  dtMs: number = TICK_MS,
): TickFireRequest[] {
  if (unit.currentHp <= 0) return [];
  const ticks: TickFireRequest[] = [];
  const remain: ActiveDuration[] = [];
  let chassisChanged = false;

  for (const d of unit.durations) {
    d.remainingMs -= dtMs;
    if (d.remainingMs <= 0) {
      if (!d.isTickShell) chassisChanged = true;
      continue;
    }
    if (d.isTickShell && d.tickIntervalMs && d.tickIntervalMs > 0) {
      let until = d.msUntilNextTick ?? d.tickIntervalMs;
      until -= dtMs;
      while (until <= 0 && d.remainingMs > 0) {
        ticks.push({ unit, duration: d });
        until += d.tickIntervalMs;
      }
      d.msUntilNextTick = until;
    }
    remain.push(d);
  }

  if (remain.length !== unit.durations.length || chassisChanged) {
    unit.durations = remain;
    recomputeChassis(unit);
  } else {
    unit.durations = remain;
  }
  return ticks;
}

/** 死亡：清空持续并重算底盘 */
export function clearDurationsOnDeath(unit: CombatUnitRuntime): void {
  if (unit.durations.length === 0) return;
  unit.durations = [];
  recomputeChassis(unit);
}

/** 解析武器作用域：持有开火武器则只改该把，否则全部 */
export function resolveWeaponIndices(
  unit: CombatUnitRuntime,
  firingWeapon: CombatWeaponRuntime | undefined,
  needWeapon: boolean,
): number[] {
  if (!needWeapon) return [];
  if (firingWeapon) {
    const idx = unit.weapons.indexOf(firingWeapon);
    if (idx >= 0) return [idx];
  }
  return unit.weapons.map((_, i) => i);
}

export function weaponsForIndices(
  unit: CombatUnitRuntime,
  indices: number[],
): CombatWeaponRuntime[] {
  if (indices.length === 0) return [];
  return indices.map(i => unit.weapons[i]).filter(Boolean);
}

export function needsWeaponScope(stat: OnHitStat): boolean {
  return isWeaponStat(stat);
}
