// 命中效果工具与管道结算单测

import { describe, expect, it } from 'vitest';
import {
  computeHitEffectValue,
  defaultDisplayName,
  migrateLegacyDamageToOnHitEffects,
  normalizeOnHitEffect,
  normalizeOnHitEffects,
  resolveHitDisplayName,
  resolveHitBuffKey,
  stampOnHitEffectList,
} from '@shared/hitEffectUtil';
import { attachOrRefreshDuration, clearDurationsOnDeath, recomputeChassis } from './durations';
import { resolveWeaponOnHitEffects } from './onhit';
import type { CombatUnitRuntime, CombatWeaponRuntime } from './types';

function makeWeapon(partial: Partial<CombatWeaponRuntime> = {}): CombatWeaponRuntime {
  const actionTime = partial.actionTime ?? 1000;
  const staminaCost = partial.staminaCost ?? 5;
  return {
    name: partial.name || '拳',
    actionTime,
    remainingTime: partial.remainingTime ?? 0,
    baseActionTime: partial.baseActionTime ?? actionTime,
    baseStaminaCost: partial.baseStaminaCost ?? staminaCost,
    damage: partial.damage ?? 0,
    staminaCost,
    ownerInstanceId: partial.ownerInstanceId || 's',
    onHitEffects: partial.onHitEffects || [],
    ...partial,
  };
}

function unit(partial: Partial<CombatUnitRuntime> & { instanceId: string }): CombatUnitRuntime {
  const { instanceId, ...rest } = partial;
  const totalHp = rest.totalHp ?? 100;
  const maxStamina = rest.maxStamina ?? 50;
  const maxLoad = rest.maxLoad ?? 50;
  const weapons = rest.weapons ?? [];
  return {
    instanceId,
    entityId: rest.entityId || instanceId,
    entityName: rest.entityName || instanceId,
    totalHp,
    currentHp: rest.currentHp ?? totalHp,
    maxStamina,
    currentStamina: rest.currentStamina ?? maxStamina,
    staminaRegen: rest.staminaRegen ?? 0,
    hpRegeneration: rest.hpRegeneration ?? 0,
    currentLoad: rest.currentLoad ?? 0,
    maxLoad,
    burden: rest.burden ?? 0,
    isOverloaded: rest.isOverloaded ?? false,
    baseTotalHp: rest.baseTotalHp ?? totalHp,
    baseMaxStamina: rest.baseMaxStamina ?? maxStamina,
    baseStaminaRegen: rest.baseStaminaRegen ?? 0,
    baseHpRegeneration: rest.baseHpRegeneration ?? 0,
    baseMaxLoad: rest.baseMaxLoad ?? maxLoad,
    slotIndex: 0,
    isStarter: true,
    weapons,
    durations: rest.durations ?? [],
    ...rest,
    passiveSources: rest.passiveSources ?? [],
    passiveMods: rest.passiveMods ?? { maxHp: 0, maxStamina: 0, maxLoad: 0, hpRegen: 0, staminaRegen: 0 },
    _prevTotalHp: rest._prevTotalHp ?? rest.totalHp ?? totalHp,
    _prevMaxStamina: rest._prevMaxStamina ?? rest.maxStamina ?? maxStamina,
  };
}

describe('hitEffectUtil', () => {
  it('百分比相对 cap 向下取整再加固定值', () => {
    expect(computeHitEffectValue(100, { percent: 33, amount: 1 })).toBe(34); // floor(33)+1
  });

  it('迁移旧 type 与 life_steal→starter', () => {
    const e = normalizeOnHitEffect({ type: 'life_steal', params: { amount: 2, percent: 10 } });
    expect(e?.stat).toBe('hp');
    expect(e?.op).toBe('gain');
    expect(e?.kind).toBe('instant');
    expect(e?.applyTo).toEqual(['starter']);
    expect(e?.displayName).toBe('吸血');
  });

  it('旧 damage 注入', () => {
    const list = migrateLegacyDamageToOnHitEffects([], 7);
    expect(list[0].op).toBe('loss');
    expect(list[0].kind).toBe('instant');
    expect(list[0].params.amount).toBe(7);
  });

  it('缺省展示名', () => {
    expect(defaultDisplayName('stamina', 'set')).toBe('耐力变为');
    expect(defaultDisplayName('burden', 'gain')).toBe('加重压');
  });

  it('持续禁止 set；Tick 壳 stat 须即时白名单', () => {
    expect(normalizeOnHitEffect({
      displayName: '坏',
      kind: 'duration',
      durationMs: 1000,
      buffKey: 'x',
      stat: 'hpRegen',
      op: 'set',
      params: { amount: 1 },
    })).toBeNull();
    expect(normalizeOnHitEffect({
      displayName: '坏毒',
      kind: 'duration',
      durationMs: 1000,
      tickIntervalMs: 500,
      buffKey: 'p',
      stat: 'maxHp',
      op: 'loss',
      params: { amount: 1 },
    })).toBeNull();
  });

  it('持续底盘合法', () => {
    const e = normalizeOnHitEffect({
      displayName: '鼓舞',
      kind: 'duration',
      durationMs: 5000,
      buffKey: 'inspire',
      stat: 'hpRegen',
      op: 'gain',
      params: { amount: 2 },
    });
    expect(e?.buffKey).toBe('inspire');
    expect(e?.tickIntervalMs).toBeUndefined();
  });
});

describe('resolveWeaponOnHitEffects', () => {
  it('gain/loss/set 与 applyTo 多选各吃一遍', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', entityName: '人类', currentHp: 50, totalHp: 100, weapons: [w] });
    const target = unit({ instanceId: 't', entityName: '哥布林', currentHp: 40, totalHp: 40 });
    const { lines } = resolveWeaponOnHitEffects([
      { displayName: '伤害', kind: 'instant', stat: 'hp', op: 'loss', params: { amount: 5 }, applyTo: ['target'] },
      { displayName: '吸血', kind: 'instant', stat: 'hp', op: 'gain', params: { amount: 3 }, applyTo: ['starter', 'actionOwner'] },
      { displayName: '锁血', kind: 'instant', stat: 'hp', op: 'set', params: { amount: 10 }, applyTo: ['target'] },
    ], { starter, actionOwner: starter, target, firingWeapon: w });

    expect(target.currentHp).toBe(10);
    expect(starter.currentHp).toBe(56);
    expect(lines.length).toBe(4);
    expect(lines[0].label).toContain('伤害 哥布林 血量 - 5');
    expect(lines[0].before).toBe(40);
    expect(lines[0].after).toBe(35);
  });

  it('percent 相对 HP 上限', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', weapons: [w] });
    const target = unit({ instanceId: 't', currentHp: 100, totalHp: 100 });
    resolveWeaponOnHitEffects([
      { displayName: '伤', kind: 'instant', stat: 'hp', op: 'loss', params: { percent: 10 }, applyTo: ['target'] },
    ], { starter, actionOwner: starter, target, firingWeapon: w });
    expect(target.currentHp).toBe(90);
  });

  it('空列表与 value<=0 跳过', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', weapons: [w] });
    const target = unit({ instanceId: 't' });
    const { lines } = resolveWeaponOnHitEffects([
      { displayName: '空', kind: 'instant', stat: 'hp', op: 'loss', params: { amount: 0 } },
    ], { starter, actionOwner: starter, target, firingWeapon: w });
    expect(lines).toEqual([]);
  });

  it('规范化旧 stamina_drain', () => {
    const n = normalizeOnHitEffects([{ type: 'stamina_drain', params: { amount: 4 } }]);
    expect(n[0].stat).toBe('stamina');
    expect(n[0].op).toBe('loss');
  });

  it('Tick 壳挂上立即首跳；同键刷新不重跳且数值取 max', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', weapons: [w] });
    const target = unit({ instanceId: 't', currentHp: 100, totalHp: 100 });
    const poison = {
      displayName: '毒',
      kind: 'duration' as const,
      durationMs: 5000,
      tickIntervalMs: 1000,
      buffKey: 'poison',
      stat: 'hp' as const,
      op: 'loss' as const,
      params: { amount: 5 },
      applyTo: ['target' as const],
    };
    const r1 = resolveWeaponOnHitEffects([poison], {
      starter, actionOwner: starter, target, firingWeapon: w,
    });
    expect(target.currentHp).toBe(95);
    expect(target.durations).toHaveLength(1);
    expect(r1.lines.some(l => l.label.includes('挂上'))).toBe(true);

    const poisonStrong = { ...poison, params: { amount: 8 } };
    const hpAfterFirst = target.currentHp;
    resolveWeaponOnHitEffects([poisonStrong], {
      starter, actionOwner: starter, target, firingWeapon: w,
    });
    // 刷新不重跳
    expect(target.currentHp).toBe(hpAfterFirst);
    expect(target.durations[0].value).toBe(8);
    expect(target.durations[0].remainingMs).toBe(5000);
  });

  it('重压计入超重', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', weapons: [w] });
    const target = unit({
      instanceId: 't',
      currentLoad: 40,
      maxLoad: 50,
      baseMaxLoad: 50,
    });
    resolveWeaponOnHitEffects([{
      displayName: '压',
      kind: 'duration',
      durationMs: 3000,
      buffKey: 'burden1',
      stat: 'burden',
      op: 'gain',
      params: { amount: 15 },
      applyTo: ['target'],
    }], { starter, actionOwner: starter, target, firingWeapon: w });
    expect(target.burden).toBe(15);
    expect(target.isOverloaded).toBe(true);
  });

  it('多键同属性代数相加', () => {
    const w = makeWeapon();
    const starter = unit({ instanceId: 's', weapons: [w] });
    const target = unit({
      instanceId: 't',
      baseHpRegeneration: 0,
      hpRegeneration: 0,
    });
    resolveWeaponOnHitEffects([
      {
        displayName: '鼓舞A', kind: 'duration', durationMs: 1000, buffKey: 'a',
        stat: 'hpRegen', op: 'gain', params: { amount: 2 }, applyTo: ['target'],
      },
      {
        displayName: '鼓舞B', kind: 'duration', durationMs: 1000, buffKey: 'b',
        stat: 'hpRegen', op: 'gain', params: { amount: 3 }, applyTo: ['target'],
      },
    ], { starter, actionOwner: starter, target, firingWeapon: w });
    expect(target.hpRegeneration).toBe(5);
  });

  it('死亡清空持续', () => {
    const u = unit({ instanceId: 't', baseHpRegeneration: 0 });
    attachOrRefreshDuration(u, {
      buffKey: 'x',
      displayName: '鼓舞',
      durationMs: 1000,
      isTickShell: false,
      stat: 'hpRegen',
      op: 'gain',
      value: 4,
      weaponIndices: [],
    });
    expect(u.hpRegeneration).toBe(4);
    u.currentHp = 0;
    clearDurationsOnDeath(u);
    expect(u.durations).toHaveLength(0);
    expect(u.hpRegeneration).toBe(0);
  });
});

describe('resolveHitDisplayName / resolveHitBuffKey', () => {
  it('returns displayName when non-empty', () => {
    const result = resolveHitDisplayName({ displayName: '毒', stat: 'hp', op: 'loss', params: {} }, '拳头');
    expect(result).toBe('毒');
  });

  it('falls back to ownerName when displayName is empty', () => {
    const result = resolveHitDisplayName({ displayName: '', stat: 'hp', op: 'loss', params: {} }, '拳头');
    expect(result).toBe('拳头');
  });

  it('resolves buffKey to displayName when buffKey is empty', () => {
    const effect = { displayName: '毒', buffKey: '', kind: 'instant' as const, stat: 'hp' as const, op: 'loss' as const, params: {} };
    const result = resolveHitBuffKey(effect, '拳头');
    expect(result).toBe('毒');
  });
});

describe('normalizeOnHitEffect displayName allowed empty', () => {
  it('allows empty displayName (no longer fills defaultDisplayName)', () => {
    const e = normalizeOnHitEffect({ stat: 'hp', op: 'loss', params: { amount: 1 } });
    expect(e).not.toBeNull();
    expect(e!.displayName).toBe('');
  });

  it('duration with empty displayName and empty buffKey passes validation (stamp fills later)', () => {
    const e = normalizeOnHitEffect({
      kind: 'duration',
      durationMs: 1000,
      stat: 'maxHp',
      op: 'loss',
      params: { amount: 1 },
    });
    expect(e).not.toBeNull();
    expect(e!.buffKey).toBe('');
    expect(e!.displayName).toBe('');
  });
});

describe('stampOnHitEffectList', () => {
  it('fills empty displayName with ownerName', () => {
    const effects = [{ displayName: '', stat: 'hp' as const, op: 'loss' as const, params: { amount: 1 } }];
    stampOnHitEffectList(effects, '拳头');
    expect(effects[0].displayName).toBe('拳头');
  });

  it('fills empty buffKey on duration effects with ownerName', () => {
    const effects = [{
      displayName: '毒', kind: 'duration' as const, durationMs: 1000, buffKey: '',
      stat: 'hp' as const, op: 'loss' as const, params: { amount: 1 },
    }];
    stampOnHitEffectList(effects, '拳头');
    expect(effects[0].buffKey).toBe('毒');
  });

  it('does not overwrite non-empty displayName', () => {
    const effects = [{ displayName: '吸血', stat: 'hp' as const, op: 'gain' as const, params: { amount: 1 } }];
    stampOnHitEffectList(effects, '拳头');
    expect(effects[0].displayName).toBe('吸血');
  });

  it('does not overwrite non-empty buffKey', () => {
    const effects = [{
      displayName: '', kind: 'duration' as const, durationMs: 1000, buffKey: 'customKey',
      stat: 'hp' as const, op: 'loss' as const, params: { amount: 1 },
    }];
    stampOnHitEffectList(effects, '拳头');
    expect(effects[0].buffKey).toBe('customKey');
  });
});

describe('recomputeChassis', () => {
  it('到期后由 durations 列表驱动还原', () => {
    const u = unit({ instanceId: 't', baseTotalHp: 100, totalHp: 100, currentHp: 100 });
    attachOrRefreshDuration(u, {
      buffKey: 'm',
      displayName: '削上限',
      durationMs: 100,
      isTickShell: false,
      stat: 'maxHp',
      op: 'loss',
      value: 20,
      weaponIndices: [],
    });
    expect(u.totalHp).toBe(80);
    u.durations = [];
    recomputeChassis(u);
    expect(u.totalHp).toBe(100);
  });
});
