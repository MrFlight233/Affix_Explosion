// 命中效果工具与管道结算单测

import { describe, expect, it } from 'vitest';
import {
  computeHitEffectValue,
  defaultDisplayName,
  migrateLegacyDamageToOnHitEffects,
  normalizeOnHitEffect,
  normalizeOnHitEffects,
} from '@shared/hitEffectUtil';
import { resolveWeaponOnHitEffects } from './onhit';
import type { CombatUnitRuntime } from './types';

function unit(partial: Partial<CombatUnitRuntime> & { instanceId: string }): CombatUnitRuntime {
  const { instanceId, ...rest } = partial;
  return {
    instanceId,
    entityId: rest.entityId || instanceId,
    entityName: rest.entityName || instanceId,
    totalHp: rest.totalHp ?? 100,
    currentHp: rest.currentHp ?? 100,
    maxStamina: rest.maxStamina ?? 50,
    currentStamina: rest.currentStamina ?? 50,
    staminaRegen: 0,
    hpRegeneration: 0,
    isOverloaded: false,
    slotIndex: 0,
    isStarter: true,
    weapons: [],
    ...rest,
  };
}

describe('hitEffectUtil', () => {
  it('百分比向下取整再加固定值', () => {
    expect(computeHitEffectValue(10, { percent: 33, amount: 1 })).toBe(4); // floor(3.3)+1
  });

  it('迁移旧 type 与 life_steal→starter', () => {
    const e = normalizeOnHitEffect({ type: 'life_steal', params: { amount: 2, percent: 10 } });
    expect(e?.stat).toBe('hp');
    expect(e?.op).toBe('gain');
    expect(e?.applyTo).toEqual(['starter']);
    expect(e?.displayName).toBe('吸血');
  });

  it('旧 damage 注入', () => {
    const list = migrateLegacyDamageToOnHitEffects([], 7);
    expect(list[0].op).toBe('loss');
    expect(list[0].params.amount).toBe(7);
  });

  it('缺省展示名', () => {
    expect(defaultDisplayName('stamina', 'set')).toBe('耐力变为');
  });
});

describe('resolveWeaponOnHitEffects', () => {
  it('gain/loss/set 与 applyTo 多选各吃一遍', () => {
    const starter = unit({ instanceId: 's', entityName: '人类', currentHp: 50, totalHp: 100 });
    const target = unit({ instanceId: 't', entityName: '哥布林', currentHp: 40, totalHp: 40 });
    const lines = resolveWeaponOnHitEffects([
      { displayName: '伤害', stat: 'hp', op: 'loss', params: { amount: 5 }, applyTo: ['target'] },
      { displayName: '吸血', stat: 'hp', op: 'gain', params: { amount: 3 }, applyTo: ['starter', 'actionOwner'] },
      { displayName: '锁血', stat: 'hp', op: 'set', params: { amount: 10 }, applyTo: ['target'] },
    ], { starter, actionOwner: starter, target });

    expect(target.currentHp).toBe(10);
    expect(starter.currentHp).toBe(56); // 50+3+3 同池双对象
    expect(lines.length).toBe(4);
    expect(lines[0].label).toContain('伤害 哥布林 血量 - 5');
    expect(lines[0].before).toBe(40);
    expect(lines[0].after).toBe(35);
    expect(lines[1].affectedName).toBe('人类');
  });

  it('空列表与 value<=0 跳过', () => {
    const starter = unit({ instanceId: 's' });
    const target = unit({ instanceId: 't' });
    const lines = resolveWeaponOnHitEffects([
      { displayName: '空', stat: 'hp', op: 'loss', params: { amount: 0 } },
    ], { starter, actionOwner: starter, target });
    expect(lines).toEqual([]);
  });

  it('规范化旧 stamina_drain', () => {
    const n = normalizeOnHitEffects([{ type: 'stamina_drain', params: { amount: 4 } }]);
    expect(n[0].stat).toBe('stamina');
    expect(n[0].op).toBe('loss');
  });
});
