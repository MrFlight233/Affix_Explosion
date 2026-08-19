import { describe, it, expect } from 'vitest';
import type { EffectDef, EffectBinding } from '@shared/effectDef';
import {
  resolveActiveBinding,
  resolvePassiveBinding,
  resolveActiveBindings,
} from '@shared/effectResolve';

describe('effectResolve', () => {
  const dmg: EffectDef = {
    id: 'a_instant_hp_loss_10',
    name: '伤害',
    allowActive: true,
    allowPassive: false,
    kind: 'instant',
    stat: 'hp',
    op: 'loss',
    defaultParams: { amount: 10 },
    defaultApplyTo: ['target'],
    paramSchema: ['amount', 'percent', 'displayName', 'applyTo'],
  };

  const maxHp: EffectDef = {
    id: 'p_instant_maxHp_gain_5',
    name: '生命加成',
    allowActive: true,
    allowPassive: true,
    kind: 'instant',
    stat: 'maxHp',
    op: 'gain',
    defaultParams: { amount: 5 },
    paramSchema: ['amount', 'displayName'],
  };

  const bleed: EffectDef = {
    id: 'a_duration_hp_loss_3',
    name: '流血',
    allowActive: true,
    allowPassive: true,
    kind: 'duration',
    stat: 'hp',
    op: 'loss',
    defaultParams: { amount: 3 },
    defaultDurationMs: 6000,
    defaultTickIntervalMs: 1000,
    defaultApplyTo: ['target'],
    paramSchema: ['amount', 'durationMs', 'tickIntervalMs', 'displayName', 'applyTo'],
  };

  it('主动绑定可覆写数量', () => {
    const binding: EffectBinding = { effectId: dmg.id, params: { amount: 12 } };
    const resolved = resolveActiveBinding(dmg, binding);
    expect(resolved?.stat).toBe('hp');
    expect(resolved?.params.amount).toBe(12);
  });

  it('挂载可覆写结算落点 applyTo', () => {
    const binding: EffectBinding = { effectId: dmg.id, applyTo: ['starter'] };
    const resolved = resolveActiveBinding(dmg, binding);
    expect(resolved?.applyTo).toEqual(['starter']);
  });

  it('流血持续可配时长与跳伤间隔', () => {
    const binding: EffectBinding = {
      effectId: bleed.id,
      params: { amount: 5, durationMs: 4000, tickIntervalMs: 500 },
    };
    const resolved = resolveActiveBinding(bleed, binding);
    expect(resolved?.kind).toBe('duration');
    expect(resolved?.params.amount).toBe(5);
    expect(resolved?.durationMs).toBe(4000);
    expect(resolved?.tickIntervalMs).toBe(500);
  });

  it('被动绑定解析 maxHp', () => {
    const binding: EffectBinding = { effectId: maxHp.id, params: { amount: 8 } };
    const resolved = resolvePassiveBinding(maxHp, binding);
    expect(resolved?.stat).toBe('maxHp');
    expect(resolved?.params.amount).toBe(8);
  });

  it('不允许被动的配方无法被动解析', () => {
    expect(resolvePassiveBinding(dmg, { effectId: dmg.id })).toBeNull();
  });

  it('多绑定按目录解析', () => {
    const catalog = new Map([[dmg.id, dmg], [bleed.id, bleed]]);
    const list = resolveActiveBindings(
      [{ effectId: dmg.id, order: 0 }, { effectId: bleed.id, order: 1 }],
      catalog,
    );
    expect(list).toHaveLength(2);
    expect(list[0].stat).toBe('hp');
    expect(list[1].kind).toBe('duration');
  });
});
