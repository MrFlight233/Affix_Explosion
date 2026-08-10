import { describe, expect, it } from 'vitest';
import {
  migrateLegacyPassiveScalars,
  resolvePassiveBonusConfig,
  normalizePassiveEffect,
  stampPassiveEffectList,
  formatPassiveEffectLine,
} from '@shared/passiveBonusUtil';

describe('passiveBonusUtil', () => {
  it('migrateLegacyPassiveScalars maps five columns', () => {
    const e = migrateLegacyPassiveScalars({
      hpBonus: 50,
      hpRegenerationBonus: 2,
      staminaBonus: -3,
      staminaRegenerationBonus: 1,
      loadBonus: 10,
    });
    expect(e).toHaveLength(5);
    expect(e.find(x => x.stat === 'maxHp')).toMatchObject({ op: 'gain', params: { amount: 50 } });
    expect(e.find(x => x.stat === 'maxStamina')).toMatchObject({ op: 'loss', params: { amount: 3 } });
  });

  it('resolve prefers passiveEffects over scalars', () => {
    const cfg = resolvePassiveBonusConfig({
      hasPassiveBonuses: true,
      passiveEffects: [{ displayName: 'x', stat: 'hpRegen', op: 'gain', params: { amount: 7 } }],
      hpBonus: 99,
    });
    expect(cfg.passiveEffects).toHaveLength(1);
    expect(cfg.passiveEffects[0].params.amount).toBe(7);
  });

  it('resolve migrates scalars when effects empty', () => {
    const cfg = resolvePassiveBonusConfig({
      hasPassiveBonuses: true,
      hpBonus: 20,
    });
    expect(cfg.passiveEffects[0].stat).toBe('maxHp');
    expect(cfg.passiveTargetCondition.filterBy).toEqual(['根实体']);
  });

  it('hasPassiveBonuses false clears', () => {
    const cfg = resolvePassiveBonusConfig({ hasPassiveBonuses: false, hpBonus: 20 });
    expect(cfg.passiveEffects).toEqual([]);
  });

  it('normalize rejects percent-only and zero amount', () => {
    expect(normalizePassiveEffect({
      stat: 'maxHp', op: 'gain', params: { percent: 10 },
    })).toBeNull();
    expect(normalizePassiveEffect({
      stat: 'maxHp', op: 'gain', params: { amount: 0 },
    })).toBeNull();
  });

  it('normalize allows empty displayName (no longer fills defaultPassiveDisplayName)', () => {
    const e = normalizePassiveEffect({ stat: 'maxHp', op: 'gain', params: { amount: 10 } });
    expect(e).not.toBeNull();
    expect(e!.displayName).toBe('');
  });

  it('formatPassiveEffectLine falls back to ownerName when displayName is empty', () => {
    const line = formatPassiveEffectLine({ displayName: '', stat: 'maxHp', op: 'gain', params: { amount: 10 } }, '拳头');
    expect(line).toContain('拳头');
    expect(line).toContain('+10');
  });

  it('formatPassiveEffectLine uses displayName when provided', () => {
    const line = formatPassiveEffectLine({ displayName: '生命加成', stat: 'maxHp', op: 'gain', params: { amount: 10 } }, '拳头');
    expect(line).toContain('生命加成');
    expect(line).not.toContain('拳头');
  });

  it('stampPassiveEffectList fills empty displayName with ownerName', () => {
    const effects = [{ displayName: '', stat: 'maxHp' as const, op: 'gain' as const, params: { amount: 10 } }];
    stampPassiveEffectList(effects, '毒刃');
    expect(effects[0].displayName).toBe('毒刃');
  });

  it('stampPassiveEffectList does not overwrite non-empty displayName', () => {
    const effects = [{ displayName: '生命加成', stat: 'maxHp' as const, op: 'gain' as const, params: { amount: 10 } }];
    stampPassiveEffectList(effects, '毒刃');
    expect(effects[0].displayName).toBe('生命加成');
  });
});
