// 目标选择：合并池 + 统一排序 + 取 N（可全部）；缺省排序 random

import type { CombatUnitRuntime, CombatWeaponRuntime } from './types';
import {
  normalizeFilterBy,
  normalizeTargetCount,
  resolveFactionTags,
  mergeFiltersWithLegacyFaction,
  resolveSortBy,
  splitFilters,
  SORT_BY_LABELS,
  FILTER_LABELS,
  type TargetCount,
} from '../targetingUtil';

export {
  normalizeFilterBy,
  normalizeTargetCount,
  resolveFactionTags,
  mergeFiltersWithLegacyFaction,
  resolveSortBy,
  formatTargetingSummary,
  SORT_BY_LABELS,
  FILTER_LABELS,
} from '../targetingUtil';

/** 从武器解析有效排序（兼容旧字段） */
function weaponSortBy(weapon: CombatWeaponRuntime): string {
  return resolveSortBy({
    sortBy: weapon.targetCondition?.sortBy,
    targetOrder: (weapon as any).targetOrder,
    priorityTarget: (weapon as any).priorityTarget,
  });
}

function weaponFilters(weapon: CombatWeaponRuntime): string[] {
  return mergeFiltersWithLegacyFaction(
    weapon.targetCondition?.filterBy,
    (weapon as any).targetFaction,
  );
}

function weaponCount(weapon: CombatWeaponRuntime): TargetCount {
  return normalizeTargetCount(weapon.targetCount ?? weapon.targetCondition?.targetCount);
}

function matchesAttrFilter(
  unit: CombatUnitRuntime,
  filter: string,
  actor: CombatUnitRuntime,
): boolean {
  switch (filter) {
    case 'not_self':
      return unit.instanceId !== actor.instanceId;
    case 'is_starter':
      return !!unit.isStarter;
    case 'is_stake':
      return !unit.isStarter;
    case 'hp_below_50pct':
      return unit.totalHp > 0 && unit.currentHp < unit.totalHp * 0.5;
    case 'has_debuff':
      return ((unit as any)._activeDebuffs?.length ?? 0) > 0;
    case 'most_buffs':
      return ((unit as any)._activeBuffs?.length ?? 0) > 0;
    default:
      return true;
  }
}

function applyAttrFilters(
  pool: CombatUnitRuntime[],
  attrs: string[],
  actor: CombatUnitRuntime,
): CombatUnitRuntime[] {
  if (attrs.length === 0) return pool;
  const filtered = pool.filter(u => attrs.every(a => matchesAttrFilter(u, a, actor)));
  // 过滤后为空则保留原池（与旧行为一致）
  return filtered.length > 0 ? filtered : pool;
}

function buildFactionPool(
  tag: string,
  actor: CombatUnitRuntime,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  isPlayer: boolean,
): CombatUnitRuntime[] {
  if (tag === '自己') {
    return actor.currentHp > 0 ? [actor] : [];
  }
  if (tag === '友方') {
    return (isPlayer ? playerUnits : enemyUnits).filter(u => u.currentHp > 0);
  }
  if (tag === '敌人') {
    return (isPlayer ? enemyUnits : playerUnits).filter(u => u.currentHp > 0);
  }
  return [];
}

/** 站位序：本侧 slotIndex；跨阵营时敌方(0) 优先于友方(1) 作为次键 */
function formationKey(u: CombatUnitRuntime, isPlayerSide: boolean, actorIsPlayer: boolean): [number, number] {
  const sideRank = (isPlayerSide === actorIsPlayer) ? 1 : 0; // 敌=0 友=1 when actor is player
  return [sideRank, u.slotIndex ?? 0];
}

function sortPool(
  pool: CombatUnitRuntime[],
  sortBy: string,
  actor: CombatUnitRuntime,
  isPlayer: boolean,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  rng: () => number,
): CombatUnitRuntime[] {
  const sorted = [...pool];
  const sideOf = (u: CombatUnitRuntime) =>
    playerUnits.some(p => p.instanceId === u.instanceId);

  const byFormationAsc = (a: CombatUnitRuntime, b: CombatUnitRuntime) => {
    const ka = formationKey(a, sideOf(a), isPlayer);
    const kb = formationKey(b, sideOf(b), isPlayer);
    return ka[0] - kb[0] || ka[1] - kb[1];
  };
  const byFormationDesc = (a: CombatUnitRuntime, b: CombatUnitRuntime) => -byFormationAsc(a, b);

  const slotMatch = /^站位([1-5])$/.exec(sortBy);
  if (slotMatch) {
    const prefer = parseInt(slotMatch[1], 10) - 1;
    sorted.sort(byFormationAsc);
    const pinned = sorted.filter(u => (u.slotIndex ?? 0) === prefer);
    const rest = sorted.filter(u => (u.slotIndex ?? 0) !== prefer);
    return [...pinned, ...rest];
  }

  switch (sortBy) {
    case '从上往下':
      sorted.sort(byFormationAsc);
      break;
    case '从下往上':
      sorted.sort(byFormationDesc);
      break;
    case '站位中间': {
      const formation = [...sorted].sort(byFormationAsc);
      const c = Math.floor((formation.length - 1) / 2);
      const indexed = formation.map((u, i) => ({ u, i, dist: Math.abs(i - c) }));
      indexed.sort((a, b) => a.dist - b.dist || a.i - b.i);
      return indexed.map(x => x.u);
    }
    case 'hp_asc':
      sorted.sort((a, b) => a.currentHp - b.currentHp);
      break;
    case 'hp_desc':
      sorted.sort((a, b) => b.currentHp - a.currentHp);
      break;
    case 'hp_pct_asc':
      sorted.sort((a, b) => (a.currentHp / Math.max(a.totalHp, 1)) - (b.currentHp / Math.max(b.totalHp, 1)));
      break;
    case 'hp_pct_desc':
      sorted.sort((a, b) => (b.currentHp / Math.max(b.totalHp, 1)) - (a.currentHp / Math.max(a.totalHp, 1)));
      break;
    case 'stamina_asc':
      sorted.sort((a, b) => a.currentStamina - b.currentStamina);
      break;
    case 'stamina_desc':
      sorted.sort((a, b) => b.currentStamina - a.currentStamina);
      break;
    case 'stamina_pct_asc':
      sorted.sort((a, b) => (a.currentStamina / Math.max(a.maxStamina, 1)) - (b.currentStamina / Math.max(b.maxStamina, 1)));
      break;
    case 'stamina_pct_desc':
      sorted.sort((a, b) => (b.currentStamina / Math.max(b.maxStamina, 1)) - (a.currentStamina / Math.max(a.maxStamina, 1)));
      break;
    case 'random':
    default:
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      break;
  }
  return sorted;
}

/**
 * 合并池选目标：阵营 OR → 属性 AND → 统一排序 → 取 N 或全部。
 */
export function selectTargets(
  weapon: CombatWeaponRuntime,
  actor: CombatUnitRuntime,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  isPlayer: boolean,
  rng: () => number = Math.random,
): CombatUnitRuntime[] {
  const filters = weaponFilters(weapon);
  const factionTags = resolveFactionTags(filters);
  const { attrs } = splitFilters(filters);

  const seen = new Set<string>();
  let pool: CombatUnitRuntime[] = [];
  for (const tag of factionTags) {
    for (const u of buildFactionPool(tag, actor, playerUnits, enemyUnits, isPlayer)) {
      if (!seen.has(u.instanceId)) {
        seen.add(u.instanceId);
        pool.push(u);
      }
    }
  }

  pool = applyAttrFilters(pool, attrs, actor);
  if (pool.length === 0) return [];

  const sortBy = weaponSortBy(weapon);
  pool = sortPool(pool, sortBy, actor, isPlayer, playerUnits, enemyUnits, rng);

  const count = weaponCount(weapon);
  if (count === 'all') return pool;
  return pool.slice(0, count);
}

/** 兼容旧单目标 API */
export function selectTarget(
  weapon: CombatWeaponRuntime,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  isPlayer: boolean,
  rng: () => number = Math.random,
  actor?: CombatUnitRuntime,
): CombatUnitRuntime | null {
  const act = actor ?? (isPlayer ? playerUnits.find(u => u.currentHp > 0) : enemyUnits.find(u => u.currentHp > 0));
  if (!act) return null;
  const list = selectTargets(weapon, act, playerUnits, enemyUnits, isPlayer, rng);
  return list[0] ?? null;
}

export function buildTargetingLabel(weapon: CombatWeaponRuntime): string {
  const filters = weaponFilters(weapon);
  const factions = resolveFactionTags(filters);
  const { attrs } = splitFilters(filters);
  const sort = weaponSortBy(weapon);
  const count = weaponCount(weapon);
  const bits: string[] = [];
  bits.push(SORT_BY_LABELS[sort] || sort);
  if (count === 'all') bits.push('全部');
  else if (count > 1) bits.push(`×${count}`);
  const fac = factions.length
    ? factions.map(f => FILTER_LABELS[f] || f).join('+')
    : '无阵营';
  bits.push(`→ ${fac}`);
  if (attrs.length) bits.push(attrs.map(a => FILTER_LABELS[a] || a).join('+'));
  return bits.join(' ');
}
