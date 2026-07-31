// 同步战斗演算核心 — 无 setTimeout，可无头 runToEnd / 逐步 step

import type { OnHitEffect } from '../data';
import {
  CombatEvent, CombatUnitRuntime, CombatWeaponRuntime,
  MAX_COMBAT_TIME, PENALTY_START_MS, TICK_MS, round6,
} from './types';
import { buildTargetingLabel, selectTargets } from './targeting';
import { resolveOnHitEffects } from './onhit';

type WeaponEntry = { unit: CombatUnitRuntime; weapon: CombatWeaponRuntime; isPlayer: boolean };

export interface SimulatorOptions {
  playerUnits: CombatUnitRuntime[];
  enemyUnits: CombatUnitRuntime[];
  playerOnHitEffects: Map<string, OnHitEffect[]>;
  enemyOnHitEffects: Map<string, OnHitEffect[]>;
  /** 可选确定性 RNG（targeting random） */
  rng?: () => number;
}

export class BattleSimulator {
  readonly playerUnits: CombatUnitRuntime[];
  readonly enemyUnits: CombatUnitRuntime[];
  readonly playerOnHitEffects: Map<string, OnHitEffect[]>;
  readonly enemyOnHitEffects: Map<string, OnHitEffect[]>;
  private readonly rng: () => number;

  combatTime = 0;
  private lastPenaltySecond = 0;
  private weaponsDirty = true;
  private allWeapons: WeaponEntry[] = [];
  private finished = false;
  private win = false;
  private readonly eventBuffer: CombatEvent[] = [];

  constructor(opts: SimulatorOptions) {
    this.playerUnits = opts.playerUnits;
    this.enemyUnits = opts.enemyUnits;
    this.playerOnHitEffects = opts.playerOnHitEffects;
    this.enemyOnHitEffects = opts.enemyOnHitEffects;
    this.rng = opts.rng ?? Math.random;
  }

  get isFinished(): boolean { return this.finished; }
  get resultWin(): boolean { return this.win; }

  /** 取出并清空事件缓冲 */
  drainEvents(): CombatEvent[] {
    const out = this.eventBuffer.splice(0, this.eventBuffer.length);
    return out;
  }

  peekEvents(): readonly CombatEvent[] {
    return this.eventBuffer;
  }

  /** 推进一个逻辑 tick（100ms）。返回本 tick 是否已结束战斗 */
  step(): boolean {
    if (this.finished) return true;

    if (!this.playerUnits.some(u => u.currentHp > 0) ||
        !this.enemyUnits.some(e => e.currentHp > 0) ||
        this.combatTime >= MAX_COMBAT_TIME) {
      this.finalize();
      return true;
    }

    this.combatTime += TICK_MS;
    this.rebuildWeaponsIfNeeded();

    // 恢复 + CD
    this.regenSide(this.playerUnits);
    this.regenSide(this.enemyUnits);

    // 触发武器
    for (const { unit, weapon, isPlayer } of this.allWeapons) {
      if (unit.currentHp <= 0) continue;
      if (weapon.remainingTime > 0) continue;

      const overloadPenalty = unit.isOverloaded ? 1.5 : 1.0;
      const effectiveCost = weapon.staminaCost * overloadPenalty;
      const damage = weapon.damage;

      if (unit.currentStamina < effectiveCost) {
        weapon.remainingTime = 0;
        continue;
      }

      unit.currentStamina = round6(unit.currentStamina - effectiveCost);

      const targets = selectTargets(weapon, unit, this.playerUnits, this.enemyUnits, isPlayer, this.rng);
      if (targets.length === 0) {
        weapon.remainingTime = weapon.actionTime;
        continue;
      }

      const hitMap = isPlayer ? this.playerOnHitEffects : this.enemyOnHitEffects;
      const label = buildTargetingLabel(weapon);
      const dmg = damage;

      for (const target of targets) {
        if (target.currentHp <= 0) continue;
        target.currentHp = round6(Math.min(target.currentHp - dmg, target.totalHp));

        const onHitLabels = resolveOnHitEffects(weapon, unit, target, dmg, hitMap);
        const effects: string[] = [];
        if (onHitLabels.length > 0) effects.push(...onHitLabels);

        this.emit({
          time: Math.round(this.combatTime),
          actorName: unit.entityName,
          weaponName: weapon.name,
          targetName: target.entityName,
          damage: dmg,
          targetHpAfter: Math.min(Math.max(target.currentHp, 0), target.totalHp),
          targetMaxHp: target.totalHp,
          effects,
          targetingLabel: label,
        });

        if (target.currentHp <= 0) {
          this.weaponsDirty = true;
          this.emit({
            time: Math.round(this.combatTime),
            actorName: '',
            weaponName: '',
            targetName: target.entityName,
            damage: 0,
            targetHpAfter: 0,
            targetMaxHp: target.totalHp,
            effects: ['击杀'],
          });
        }
      }

      weapon.remainingTime = weapon.actionTime;
    }

    // 软狂暴
    if (this.combatTime > PENALTY_START_MS) {
      const overtimeSeconds = Math.floor((this.combatTime - PENALTY_START_MS) / 1000);
      if (overtimeSeconds > this.lastPenaltySecond) {
        this.lastPenaltySecond = overtimeSeconds;
        const penaltyDamage = overtimeSeconds * 10;
        this.applyPenalty(this.playerUnits, penaltyDamage);
        this.applyPenalty(this.enemyUnits, penaltyDamage);
        this.emit({
          time: Math.round(this.combatTime), actorName: '', weaponName: '',
          targetName: '超时惩罚', damage: penaltyDamage,
          targetHpAfter: 0, targetMaxHp: 0,
          effects: [`${overtimeSeconds}秒`],
        });
      }
    }

    if (!this.playerUnits.some(u => u.currentHp > 0) ||
        !this.enemyUnits.some(e => e.currentHp > 0) ||
        this.combatTime >= MAX_COMBAT_TIME) {
      this.finalize();
      return true;
    }
    return false;
  }

  /** 同步跑至结束（无头），返回胜负。事件留在 buffer 中可 drain */
  runToEnd(): { win: boolean; combatTime: number } {
    while (!this.step()) { /* continue */ }
    return { win: this.win, combatTime: this.combatTime };
  }

  /** 连续步进最多 maxSteps 次，返回是否已结束 */
  stepN(maxSteps: number): boolean {
    for (let i = 0; i < maxSteps; i++) {
      if (this.step()) return true;
    }
    return this.finished;
  }

  private emit(evt: CombatEvent) {
    this.eventBuffer.push(evt);
  }

  private regenSide(units: CombatUnitRuntime[]) {
    for (const u of units) {
      if (u.currentHp <= 0) continue;
      u.currentStamina = round6(Math.min(u.currentStamina + u.staminaRegen * TICK_MS / 1000, u.maxStamina));
      u.currentHp = round6(Math.min(u.currentHp + u.hpRegeneration * TICK_MS / 1000, u.totalHp));
      for (const w of u.weapons) w.remainingTime -= TICK_MS;
    }
  }

  private rebuildWeaponsIfNeeded() {
    if (!this.weaponsDirty && this.allWeapons.length > 0) {
      // 仍校验：若有阵亡单位残留则重建
      if (this.allWeapons.every(e => e.unit.currentHp > 0)) return;
    }
    this.allWeapons = [];
    for (const u of this.playerUnits) {
      if (u.currentHp <= 0) continue;
      for (const w of u.weapons) this.allWeapons.push({ unit: u, weapon: w, isPlayer: true });
    }
    for (const e of this.enemyUnits) {
      if (e.currentHp <= 0) continue;
      for (const w of e.weapons) this.allWeapons.push({ unit: e, weapon: w, isPlayer: false });
    }
    this.weaponsDirty = false;
  }

  private applyPenalty(units: CombatUnitRuntime[], penaltyDamage: number) {
    for (const u of units) {
      if (u.currentHp <= 0) continue;
      u.currentHp = round6(Math.max(u.currentHp - penaltyDamage, 0));
      if (u.currentHp <= 0) {
        this.weaponsDirty = true;
        this.emit({
          time: Math.round(this.combatTime), actorName: '', weaponName: '',
          targetName: u.entityName, damage: penaltyDamage,
          targetHpAfter: 0, targetMaxHp: u.totalHp, effects: ['击杀'],
        });
      }
    }
  }

  private finalize() {
    if (this.finished) return;
    this.finished = true;
    const playerAlive = this.playerUnits.some(u => u.currentHp > 0);
    const enemyAlive = this.enemyUnits.some(e => e.currentHp > 0);
    this.win = this.combatTime >= MAX_COMBAT_TIME || playerAlive || !enemyAlive;
  }
}
