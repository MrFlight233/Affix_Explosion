// 被动加成运行时：全量重算（存在维持）

import type { PassiveStat } from '../passiveBonusUtil';
import type { TargetCondition } from '../data';
import { selectTargets } from './targeting';
import { recomputeChassis } from './durations';
import type { CombatUnitRuntime, CombatWeaponRuntime, PassiveModBag } from './types';
import { emptyPassiveMods, round6 } from './types';

export type CombatSide = 'player' | 'enemy';

/** 单次被动施加记录（开战预处理明细日志） */
export interface PassiveApplyRecord {
  sourceName: string;
  sourceSide: CombatSide;
  targetName: string;
  targetSide: CombatSide;
  displayName: string;
  stat: PassiveStat;
  op: 'gain' | 'loss';
  amount: number;
}

function addMod(bag: PassiveModBag, stat: PassiveStat, signed: number): void {
  switch (stat) {
    case 'maxHp': bag.maxHp = round6(bag.maxHp + signed); break;
    case 'maxStamina': bag.maxStamina = round6(bag.maxStamina + signed); break;
    case 'maxLoad': bag.maxLoad = round6(bag.maxLoad + signed); break;
    case 'hpRegen': bag.hpRegen = round6(bag.hpRegen + signed); break;
    case 'staminaRegen': bag.staminaRegen = round6(bag.staminaRegen + signed); break;
  }
}

function fakeWeapon(
  tc: TargetCondition,
  count: number | 'all',
): CombatWeaponRuntime {
  return {
    name: '__passive__',
    actionTime: 0,
    remainingTime: 0,
    baseActionTime: 0,
    baseStaminaCost: 0,
    damage: 0,
    staminaCost: 0,
    targetCount: count,
    targetCondition: tc,
    ownerInstanceId: '',
    onHitEffects: [],
  };
}

const STAT_LABEL: Record<PassiveStat, string> = {
  maxHp: 'HP上限',
  maxStamina: '耐力上限',
  maxLoad: '负重上限',
  hpRegen: '生命恢复',
  staminaRegen: '耐力恢复',
};

/** 预处理明细子行文案（无 HTML） */
export function formatPassiveApplyEffectLine(r: PassiveApplyRecord): string {
  const label = STAT_LABEL[r.stat] || r.stat;
  const signed = r.op === 'gain' ? r.amount : -r.amount;
  const sym = signed >= 0 ? '+' : '';
  const name = r.displayName || '被动';
  return `${name} ${label} ${sym}${signed}`;
}

/**
 * 全量重算双方被动修饰并刷新底盘。
 * 默认仅存活单位作为来源与受益者；includeDead=true 用于开战 0.0s 预处理。
 */
export function recomputePassiveBonuses(
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  rng?: () => number,
  includeDead = false,
  onApply?: (rec: PassiveApplyRecord) => void,
): void {
  const all = [...playerUnits, ...enemyUnits];
  for (const u of all) {
    u.passiveMods = emptyPassiveMods();
  }

  const sideOf = (u: CombatUnitRuntime): CombatSide =>
    playerUnits.includes(u) ? 'player' : 'enemy';

  const applyFromSide = (side: CombatUnitRuntime[], isPlayer: boolean) => {
    const sourceSide: CombatSide = isPlayer ? 'player' : 'enemy';
    for (const actor of side) {
      if (!includeDead && actor.currentHp <= 0) continue;
      const sources = actor.passiveSources || [];
      for (const src of sources) {
        if (!src.effects || src.effects.length === 0) continue;
        const weapon = fakeWeapon(src.targetCondition, src.targetCount);
        const targets = selectTargets(
          weapon,
          actor,
          playerUnits,
          enemyUnits,
          isPlayer,
          rng,
          includeDead,
        );
        for (const t of targets) {
          if (!includeDead && t.currentHp <= 0) continue;
          for (const e of src.effects) {
            const signed = e.op === 'gain' ? e.params.amount : -e.params.amount;
            addMod(t.passiveMods, e.stat, signed);
            onApply?.({
              sourceName: actor.entityName,
              sourceSide,
              targetName: t.entityName,
              targetSide: sideOf(t),
              displayName: e.displayName || '被动',
              stat: e.stat,
              op: e.op,
              amount: e.params.amount,
            });
          }
        }
      }
    }
  };

  applyFromSide(playerUnits, true);
  applyFromSide(enemyUnits, false);

  for (const u of all) {
    recomputeChassis(u);
  }
}

/** 战斗修饰汇总（不含来源名） */
export function summarizePassiveMods(unit: CombatUnitRuntime): string[] {
  const m = unit.passiveMods || emptyPassiveMods();
  const lines: string[] = [];
  const push = (label: string, v: number) => {
    if (v === 0) return;
    lines.push(`${label} ${v > 0 ? '+' : ''}${v}`);
  };
  push('HP上限', m.maxHp);
  push('耐力上限', m.maxStamina);
  push('负重上限', m.maxLoad);
  push('生命恢复', m.hpRegen);
  push('耐力恢复', m.staminaRegen);
  return lines;
}

/** 战斗修饰按来源逐条展示，含来源名 */
export function summarizePassiveModsBySource(unit: CombatUnitRuntime): string[] {
  const sources = unit.passiveSources || [];
  const lines: string[] = [];
  const statLabel: Record<string, string> = {
    maxHp: 'HP上限',
    maxStamina: '耐力上限',
    maxLoad: '负重上限',
    hpRegen: '生命恢复',
    staminaRegen: '耐力恢复',
  };
  for (const src of sources) {
    const srcName = src.ownerName || '未知来源';
    for (const e of src.effects || []) {
      const label = statLabel[e.stat] || e.stat;
      const signed = e.op === 'loss' ? -e.params.amount : e.params.amount;
      if (signed === 0) continue;
      lines.push(`${srcName} ${label} ${signed > 0 ? '+' : ''}${signed}`);
    }
  }
  return lines;
}
