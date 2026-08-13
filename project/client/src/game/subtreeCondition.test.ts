import { describe, expect, it, beforeEach } from 'vitest';
import {
  AFFIX_DEFS,
  ENTITY_DEFS,
  canMountAffix,
  countMatchingAffixesInSubtree,
  evaluateSubtreeCondition,
  type AffixDef,
  type EntityDef,
  type ItemInstance,
} from './data';

function clearDefs() {
  AFFIX_DEFS.length = 0;
  ENTITY_DEFS.length = 0;
}

function seedBasic() {
  clearDefs();
  AFFIX_DEFS.push(
    {
      id: 'fighter',
      name: '战士',
      category: 'path',
      costValue: 20,
      slotCost: 2,
      repeatable: false,
      prerequisite: [],
      poolPrerequisite: [],
      effect: '开启战士路线',
      onHitEffects: [],
    } as AffixDef,
    {
      id: 'weapon',
      name: '武器',
      category: 'tag',
      costValue: 0,
      slotCost: 0,
      repeatable: true,
      prerequisite: [],
      poolPrerequisite: [],
      effect: '',
      onHitEffects: [],
    } as AffixDef,
  );
  ENTITY_DEFS.push(
    {
      id: 'human',
      name: '人类',
      categories: ['starter'],
      isStarter: true,
      isActive: false,
      hp: 100,
      maxStamina: 50,
      staminaRegen: 5,
      weight: 0,
      maxLoad: 100,
      slotCost: 0,
      entitySlots: 4,
      dynamicAffixSlots: 4,
      fixedAffixes: [],
      poolPrerequisite: [],
      onHitEffects: [],
      hasPassiveBonuses: false,
      passiveEffects: [],
    } as unknown as EntityDef,
    {
      id: 'standard_long_sword',
      name: '制式长剑',
      categories: ['weapon'],
      isStarter: false,
      isActive: true,
      hp: 1,
      maxStamina: 0,
      staminaRegen: 0,
      weight: 10,
      maxLoad: 0,
      slotCost: 1,
      entitySlots: 0,
      dynamicAffixSlots: 1,
      fixedAffixes: ['weapon', 'fighter'],
      poolPrerequisite: ['fighter'],
      onHitEffects: [],
      hasPassiveBonuses: true,
      passiveEffects: [{
        displayName: '斗士亲和-生命',
        stat: 'maxHp',
        op: 'gain',
        params: { amount: 20 },
        condition: { matchIds: ['fighter'], min: 2 },
      }],
      passiveTargetCondition: { sortBy: 'random', filterBy: ['根实体'] },
      passiveTargetCount: 1,
    } as unknown as EntityDef,
  );
}

function item(partial: Partial<ItemInstance> & { instanceId: string; defId: string; type: 'entity' | 'affix' }): ItemInstance {
  return { children: [], ...partial };
}

describe('countMatchingAffixesInSubtree / evaluateSubtreeCondition', () => {
  beforeEach(seedBasic);

  it('counts fixedAffixes on nested entity + dynamic affix on root', () => {
    const sword = item({
      instanceId: 'sw',
      defId: 'standard_long_sword',
      type: 'entity',
    });
    const fighterDyn = item({ instanceId: 'f1', defId: 'fighter', type: 'affix' });
    const human = item({
      instanceId: 'h1',
      defId: 'human',
      type: 'entity',
      children: [fighterDyn, sword],
    });
    expect(countMatchingAffixesInSubtree([human], ['fighter'])).toBe(2);
    expect(evaluateSubtreeCondition({ matchIds: ['fighter'], min: 2 }, [human])).toBe(true);
  });

  it('sword alone has only 1 fighter from fixedAffixes', () => {
    const sword = item({
      instanceId: 'sw',
      defId: 'standard_long_sword',
      type: 'entity',
    });
    const human = item({
      instanceId: 'h1',
      defId: 'human',
      type: 'entity',
      children: [sword],
    });
    expect(countMatchingAffixesInSubtree([human], ['fighter'])).toBe(1);
    expect(evaluateSubtreeCondition({ matchIds: ['fighter'], min: 2 }, [human])).toBe(false);
  });

  it('counts fixed and dynamic separately on same entity if both present', () => {
    const fighterDyn = item({ instanceId: 'f1', defId: 'fighter', type: 'affix' });
    const sword = item({
      instanceId: 'sw',
      defId: 'standard_long_sword',
      type: 'entity',
      children: [fighterDyn],
    });
    expect(countMatchingAffixesInSubtree([sword], ['fighter'])).toBe(2);
  });
});

describe('canMountAffix repeatable', () => {
  beforeEach(seedBasic);

  it('rejects non-repeatable affix already in fixedAffixes', () => {
    const sword = item({
      instanceId: 'sw',
      defId: 'standard_long_sword',
      type: 'entity',
    });
    const err = canMountAffix(sword, 'fighter');
    expect(err).toBeTruthy();
    expect(err!).toContain('不可重复');
  });

  it('allows affix not yet owned', () => {
    const human = item({
      instanceId: 'h1',
      defId: 'human',
      type: 'entity',
    });
    expect(canMountAffix(human, 'fighter')).toBeNull();
  });
});
