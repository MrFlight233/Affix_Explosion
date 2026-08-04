import { describe, expect, it } from 'vitest';
import { buildCombatRuntime } from './types';
import { recomputePassiveBonuses } from './passives';
import { emptyPassiveMods } from './types';
import type { CombatUnitSnapshot } from './types';

function unit(partial: Partial<CombatUnitSnapshot> & { instanceId: string; entityName: string }): CombatUnitSnapshot {
  return {
    entityId: partial.entityId || partial.instanceId,
    totalHp: partial.totalHp ?? 100,
    currentHp: partial.currentHp ?? 100,
    totalStaminaRegen: partial.totalStaminaRegen ?? 5,
    maxStamina: partial.maxStamina ?? 50,
    currentStamina: partial.currentStamina ?? 50,
    staminaRegen: partial.staminaRegen ?? 5,
    totalHpRegeneration: partial.totalHpRegeneration ?? 0,
    currentLoad: partial.currentLoad ?? 0,
    maxLoad: partial.maxLoad ?? 20,
    isOverloaded: false,
    slotIndex: partial.slotIndex ?? 0,
    isStarter: partial.isStarter ?? true,
    activeWeapons: [],
    passiveSources: partial.passiveSources || [],
    ...partial,
  };
}

describe('recomputePassiveBonuses', () => {
  it('self maxHp applies to actor', () => {
    const snap = unit({
      instanceId: 'a',
      entityName: 'A',
      totalHp: 100,
      passiveSources: [{
        effects: [{ displayName: '生命加成', stat: 'maxHp', op: 'gain', params: { amount: 50 } }],
        targetCondition: { sortBy: 'random', filterBy: ['自己'] },
        targetCount: 1,
      }],
    });
    const [rt] = buildCombatRuntime([snap]);
    recomputePassiveBonuses([rt], [], () => 0);
    expect(rt.totalHp).toBe(150);
    expect(rt.passiveMods.maxHp).toBe(50);
  });

  it('ally aura applies to other living starters', () => {
    const a = unit({
      instanceId: 'aura',
      entityName: 'Aura',
      slotIndex: 0,
      passiveSources: [{
        effects: [{ displayName: '鼓舞', stat: 'staminaRegen', op: 'gain', params: { amount: 5 } }],
        targetCondition: { sortBy: '从上往下', filterBy: ['友方'] },
        targetCount: 'all',
      }],
    });
    const b = unit({ instanceId: 'b', entityName: 'B', slotIndex: 1, totalStaminaRegen: 5 });
    const rts = buildCombatRuntime([a, b]);
    recomputePassiveBonuses(rts, [], () => 0);
    expect(rts[0].staminaRegen).toBe(10);
    expect(rts[1].staminaRegen).toBe(10);
  });

  it('dead source clears contribution', () => {
    const a = unit({
      instanceId: 'aura',
      entityName: 'Aura',
      passiveSources: [{
        effects: [{ displayName: '鼓舞', stat: 'staminaRegen', op: 'gain', params: { amount: 5 } }],
        targetCondition: { sortBy: '从上往下', filterBy: ['友方'] },
        targetCount: 'all',
      }],
    });
    const b = unit({ instanceId: 'b', entityName: 'B' });
    const rts = buildCombatRuntime([a, b]);
    recomputePassiveBonuses(rts, [], () => 0);
    expect(rts[1].staminaRegen).toBe(10);
    rts[0].currentHp = 0;
    recomputePassiveBonuses(rts, [], () => 0);
    expect(rts[1].staminaRegen).toBe(5);
    expect(rts[1].passiveMods).toEqual(emptyPassiveMods());
  });

  it('stake root can emit aura', () => {
    const stake = unit({
      instanceId: 'stake',
      entityName: '木桩',
      isStarter: false,
      totalHp: 1,
      currentHp: 1,
      passiveSources: [{
        effects: [{ displayName: '鼓舞', stat: 'staminaRegen', op: 'gain', params: { amount: 3 } }],
        targetCondition: { sortBy: '从上往下', filterBy: ['友方'] },
        targetCount: 'all',
      }],
    });
    const ally = unit({ instanceId: 'ally', entityName: 'Ally', slotIndex: 1, staminaRegen: 5 });
    const rts = buildCombatRuntime([stake, ally]);
    recomputePassiveBonuses(rts, [], () => 0);
    expect(rts[1].staminaRegen).toBe(8);
  });

  it('correct base then one aura is +5 once (no double bake)', () => {
    const snap = unit({
      instanceId: 'a',
      entityName: '精灵',
      totalStaminaRegen: 8,
      staminaRegen: 8,
      isStarter: true,
      passiveSources: [{
        effects: [{ displayName: '鼓舞', stat: 'staminaRegen', op: 'gain', params: { amount: 5 } }],
        targetCondition: { sortBy: '从上往下', filterBy: ['友方', 'is_starter'] },
        targetCount: 'all',
      }],
    });
    const [rt] = buildCombatRuntime([snap]);
    recomputePassiveBonuses([rt], [], () => 0);
    expect(rt.baseStaminaRegen).toBe(8);
    expect(rt.staminaRegen).toBe(13);
    recomputePassiveBonuses([rt], [], () => 0);
    expect(rt.staminaRegen).toBe(13); // 全量重算不叠层
  });

  it('stacks with duration chassis algebraically', () => {
    const snap = unit({
      instanceId: 'a',
      entityName: 'A',
      totalHp: 100,
      totalHpRegeneration: 1,
      passiveSources: [{
        effects: [{ displayName: '生命恢复加成', stat: 'hpRegen', op: 'gain', params: { amount: 2 } }],
        targetCondition: { sortBy: 'random', filterBy: ['自己'] },
        targetCount: 1,
      }],
    });
    const [rt] = buildCombatRuntime([snap]);
    rt.durations.push({
      buffKey: 'tmp',
      displayName: '短 buff',
      remainingMs: 5000,
      isTickShell: false,
      stat: 'hpRegen',
      op: 'gain',
      value: 3,
      weaponIndices: [],
    });
    recomputePassiveBonuses([rt], [], () => 0);
    // base 1 + passive 2 + duration 3
    expect(rt.hpRegeneration).toBe(6);
  });
});
