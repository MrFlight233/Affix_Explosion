import { describe, it, expect } from 'vitest';
import { selectTargets, buildTargetingLabel } from './targeting';
import {
  resolveSortBy,
  normalizeFilterBy,
  normalizeTargetCount,
  formatTargetingSummary,
  resolveFactionTags,
  mergeFiltersWithLegacyFaction,
} from '../targetingUtil';
import { buildCombatRuntime, type CombatUnitSnapshot, type CombatWeaponRuntime } from './types';

function unit(
  id: string,
  opts: Partial<CombatUnitSnapshot> & { hp?: number; maxHp?: number; stamina?: number; maxStamina?: number; slot?: number; starter?: boolean } = {},
): CombatUnitSnapshot {
  const hp = opts.hp ?? opts.currentHp ?? 20;
  const maxHp = opts.maxHp ?? opts.totalHp ?? hp;
  const stam = opts.stamina ?? opts.currentStamina ?? 50;
  const maxStam = opts.maxStamina ?? 50;
  return {
    instanceId: id,
    entityId: id,
    entityName: id,
    totalHp: maxHp,
    currentHp: hp,
    totalStaminaRegen: 5,
    maxStamina: maxStam,
    currentStamina: stam,
    staminaRegen: 5,
    totalHpRegeneration: 0,
    currentLoad: 0,
    maxLoad: 50,
    isOverloaded: false,
    slotIndex: opts.slot ?? opts.slotIndex ?? 0,
    isStarter: opts.starter ?? opts.isStarter ?? true,
    activeWeapons: [],
    ...opts,
  };
}

function weapon(partial: Partial<CombatWeaponRuntime> & { sortBy?: string; filterBy?: string | string[]; count?: number | 'all' } = {}): CombatWeaponRuntime {
  const { sortBy, filterBy, count, targetCondition, ...rest } = partial;
  return {
    name: 'w',
    actionTime: 1000,
    remainingTime: 0,
    damage: 5,
    staminaCost: 1,
    ownerInstanceId: 'p0',
    ...rest,
    targetCount: count ?? rest.targetCount ?? 1,
    targetCondition: {
      sortBy: sortBy ?? targetCondition?.sortBy,
      filterBy: filterBy ?? targetCondition?.filterBy,
    },
  };
}

function ids(list: { instanceId: string }[]) {
  return list.map(u => u.instanceId);
}

describe('resolveSortBy / normalize / faction', () => {
  it('缺省为 random', () => {
    expect(resolveSortBy({})).toBe('random');
  });
  it('无阵营 → 空标签', () => {
    expect(resolveFactionTags([])).toEqual([]);
    expect(resolveFactionTags(['hp_below_50pct'])).toEqual([]);
  });
  it('遗留 targetFaction 并入', () => {
    expect(mergeFiltersWithLegacyFaction(['hp_below_50pct'], '敌人')).toEqual(['hp_below_50pct', '敌人']);
    expect(mergeFiltersWithLegacyFaction(['敌人'], '友方')).toEqual(['敌人']);
    expect(factionAll()).toEqual(['友方', '敌人']);
  });
  it('priorityTarget → 站位k', () => {
    expect(resolveSortBy({ priorityTarget: 2, sortBy: 'hp_asc' })).toBe('站位2');
  });
  it('filter 数组与旧 string', () => {
    expect(normalizeFilterBy(['友方', 'not_self'])).toEqual(['友方', 'not_self']);
    expect(normalizeFilterBy('hp_below_50pct')).toEqual(['hp_below_50pct']);
  });
  it('targetCount all/-1', () => {
    expect(normalizeTargetCount('all')).toBe('all');
    expect(normalizeTargetCount(-1)).toBe('all');
    expect(normalizeTargetCount(undefined)).toBe(1);
  });
});

function factionAll() {
  return mergeFiltersWithLegacyFaction([], '所有');
}

describe('selectTargets 场景', () => {
  const enemies = buildCombatRuntime([
    unit('e0', { slot: 0, hp: 20, maxHp: 20 }),
    unit('e1', { slot: 1, hp: 10, maxHp: 30 }),
    unit('e2', { slot: 2, hp: 5, maxHp: 25 }),
  ]);
  const players = buildCombatRuntime([
    unit('p0', { slot: 0, hp: 40, maxHp: 40, starter: true }),
    unit('p1', { slot: 1, hp: 15, maxHp: 40, starter: true }),
    unit('p2', { slot: 2, hp: 8, maxHp: 10, starter: false }),
  ]);
  const actor = players[0];

  it('1 敌人+从上往下+N=2', () => {
    const t = selectTargets(weapon({ sortBy: '从上往下', filterBy: ['敌人'], count: 2 }), actor, players, enemies, true, () => 0);
    expect(ids(t)).toEqual(['e0', 'e1']);
  });

  it('2 敌人+从下往上+N=1', () => {
    const t = selectTargets(weapon({ sortBy: '从下往上', filterBy: ['敌人'], count: 1 }), actor, players, enemies, true, () => 0);
    expect(ids(t)).toEqual(['e2']);
  });

  it('3 敌人+站位2+N=1', () => {
    const t = selectTargets(weapon({ sortBy: '站位2', filterBy: ['敌人'], count: 1 }), actor, players, enemies, true, () => 0);
    expect(ids(t)).toEqual(['e1']);
  });

  it('4 友方+全部', () => {
    const t = selectTargets(
      weapon({ filterBy: ['友方'], sortBy: '从上往下', count: 'all' }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['p0', 'p1', 'p2']);
  });

  it('5 自己', () => {
    const t = selectTargets(
      weapon({ filterBy: ['自己'], sortBy: '从上往下', count: 1 }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['p0']);
  });

  it('6 友方+hp_pct_asc+N=2', () => {
    const t = selectTargets(
      weapon({ filterBy: ['友方'], sortBy: 'hp_pct_asc', count: 2 }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['p1', 'p2']);
    const abs = selectTargets(
      weapon({ filterBy: ['友方'], sortBy: 'hp_asc', count: 2 }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(abs)).toEqual(['p2', 'p1']);
  });

  it('7 友方+stamina_pct_asc+全部', () => {
    const custom = buildCombatRuntime([
      unit('a', { slot: 0, stamina: 10, maxStamina: 100 }),
      unit('b', { slot: 1, stamina: 40, maxStamina: 50 }),
    ]);
    const t = selectTargets(
      weapon({ filterBy: ['友方'], sortBy: 'stamina_pct_asc', count: 'all' }),
      custom[0], custom, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['a', 'b']);
  });

  it('8 友方+hp_below_50pct+从上往下+N=1', () => {
    const t = selectTargets(
      weapon({ filterBy: ['友方', 'hp_below_50pct'], sortBy: '从上往下', count: 1 }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['p1']);
  });

  it('无阵营 → 空目标', () => {
    const t = selectTargets(
      weapon({ filterBy: ['hp_below_50pct'], sortBy: '从上往下', count: 1 }),
      actor, players, enemies, true, () => 0,
    );
    expect(t).toEqual([]);
  });

  it('遗留 targetFaction 仍可选中', () => {
    const w = weapon({ sortBy: '从上往下', count: 1, filterBy: [] });
    (w as any).targetFaction = '敌人';
    const t = selectTargets(w, actor, players, enemies, true, () => 0);
    expect(ids(t)).toEqual(['e0']);
  });

  it('站位中间 N=1', () => {
    const mid1 = selectTargets(weapon({ sortBy: '站位中间', filterBy: ['敌人'], count: 1 }), actor, players, enemies, true, () => 0);
    expect(ids(mid1)).toEqual(['e1']);
  });

  it('缺省 random：友+敌抽 1', () => {
    const t = selectTargets(
      weapon({ filterBy: ['友方', '敌人'], count: 1 }),
      actor, players, enemies, true, () => 0.5,
    );
    expect(t).toHaveLength(1);
  });

  it('not_self 过滤', () => {
    const t = selectTargets(
      weapon({ filterBy: ['友方', 'not_self'], sortBy: '从上往下', count: 1 }),
      actor, players, enemies, true, () => 0,
    );
    expect(ids(t)).toEqual(['p1']);
  });

  it('formatTargetingSummary 无阵营', () => {
    const s = formatTargetingSummary({ filterBy: [], sortBy: 'random', targetCount: 1 });
    expect(s).toContain('无阵营');
    const label = buildTargetingLabel(weapon({ sortBy: 'hp_pct_asc', count: 2, filterBy: ['敌人', 'not_self'] }));
    expect(label).toContain('HP%最低');
  });
});
