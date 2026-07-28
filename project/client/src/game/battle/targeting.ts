// 目标选择纯函数（条件 targeting > priorityTarget > targetOrder）

import type { CombatUnitRuntime, CombatWeaponRuntime } from './types';

export function selectTarget(
  weapon: CombatWeaponRuntime,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  isPlayer: boolean,
  rng: () => number = Math.random,
): CombatUnitRuntime | null {
  const faction = weapon.targetFaction || '敌人';

  let candidates: CombatUnitRuntime[];
  if (faction === '友方') {
    candidates = isPlayer ? playerUnits : enemyUnits;
  } else if (faction === '所有') {
    const opposing = isPlayer ? enemyUnits : playerUnits;
    const friendly = isPlayer ? playerUnits : enemyUnits;
    candidates = [...opposing, ...friendly];
  } else {
    candidates = isPlayer ? enemyUnits : playerUnits;
  }

  let alive = candidates.filter(c => c.currentHp > 0);
  if (alive.length === 0) return null;

  const tc = weapon.targetCondition;
  if (tc) {
    let pool = alive;
    if (tc.filterBy) {
      const filtered = pool.filter(c => matchesFilter(c, tc.filterBy!));
      if (filtered.length > 0) pool = filtered;
    }
    if (tc.sortBy && pool.length > 1) {
      pool = sortCandidates(pool, tc.sortBy, rng);
    }
    return pool[0];
  }

  const preferIdx = weapon.priorityTarget;
  if (preferIdx !== null) {
    const idx = preferIdx - 1;
    if (idx >= 0 && idx < candidates.length && candidates[idx].currentHp > 0) {
      return candidates[idx];
    }
  }

  if (weapon.targetOrder === '从下往上') {
    return alive[alive.length - 1];
  }
  return alive[0];
}

export function matchesFilter(unit: CombatUnitRuntime, filter: string): boolean {
  switch (filter) {
    case 'hp_below_50pct':
      return unit.currentHp < unit.totalHp * 0.5;
    case 'has_debuff':
      return (unit as any)._activeDebuffs?.length > 0;
    case 'most_buffs':
      return (unit as any)._activeBuffs?.length > 0;
    default:
      return true;
  }
}

export function sortCandidates(
  alive: CombatUnitRuntime[],
  sortBy: string,
  rng: () => number = Math.random,
): CombatUnitRuntime[] {
  const sorted = [...alive];
  switch (sortBy) {
    case 'hp_asc':
      sorted.sort((a, b) => a.currentHp - b.currentHp);
      break;
    case 'hp_desc':
      sorted.sort((a, b) => b.currentHp - a.currentHp);
      break;
    case 'stamina_asc':
      sorted.sort((a, b) => a.currentStamina - b.currentStamina);
      break;
    case 'random':
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      break;
  }
  return sorted;
}

export function buildTargetingLabel(weapon: CombatWeaponRuntime): string {
  const tc = weapon.targetCondition;
  let targetingLabel = '';
  if (tc?.sortBy === 'hp_asc') targetingLabel = 'HP最低优先';
  else if (tc?.sortBy === 'hp_desc') targetingLabel = 'HP最高优先';
  else if (tc?.sortBy === 'stamina_asc') targetingLabel = '耐力最低优先';
  else if (tc?.sortBy === 'random') targetingLabel = '随机';
  else if (weapon.priorityTarget !== null) targetingLabel = `前排优先${weapon.priorityTarget}`;
  else if (weapon.targetOrder === '从下往上') targetingLabel = '从后往前';
  else targetingLabel = '从上往下';

  if (weapon.targetFaction === '友方') targetingLabel += ' → 友方';
  else if (weapon.targetFaction === '所有') targetingLabel += ' → 所有';
  return targetingLabel;
}
