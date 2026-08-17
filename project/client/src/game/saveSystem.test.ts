import './testLocalStorage';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSaveQueue } from './saveQueue';
import {
  GameEngine,
  COMBAT_RNG_VERSION,
  seededRandom,
} from './engine';
import { reloadData, type EntityDef, type AffixDef } from './data';
import { BattleSimulator } from './battle/simulator';
import { buildCombatRuntime, type CombatUnitSnapshot } from './battle/types';
import { eventFingerprint } from './battle/onhit';

function seedMinimal() {
  const entities = [
    {
      id: 'human', name: '人类', slotCost: 1, entitySlots: 2, weight: 0, value: 5,
      fixedAffixes: ['starter'], dynamicAffixSlots: 2, poolPrerequisite: [],
      hp: 100, maxStamina: 50, staminaRegen: 5, hpRegen: 0, maxLoad: 50,
      isActive: true, staminaCost: 10, actionTime: 1000, damage: 0,
      targetType: null, targetOrder: null, priorityTarget: null, targetFaction: 'enemy',
      staminaRegenerationBonus: 0, staminaBonus: 0, hpRegenerationBonus: 0, hpBonus: 0,
    },
  ] as unknown as EntityDef[];
  const affixes = [
    {
      id: 'starter', name: '启动', category: 'misc', costValue: 0, slotCost: 0, value: 0,
      repeatable: false, prerequisite: [], poolPrerequisite: [], effect: '',
      onHitEffects: [], staminaRegenerationBonus: 0, staminaBonus: 0,
      hpRegenerationBonus: 0, hpBonus: 0, loadBonus: 0,
    },
  ] as unknown as AffixDef[];
  reloadData(entities, affixes);
}

describe('createSaveQueue', () => {
  it('coalesce：多次 request 后 flush 写入最新状态', async () => {
    const payloads: number[] = [];
    let state = 0;
    const put = vi.fn(async (p: unknown) => {
      payloads.push(p as number);
    });
    const q = createSaveQueue({
      getPayload: () => state,
      put,
    });

    state = 1;
    q.request();
    state = 2;
    q.request();
    state = 3;
    q.request();
    await q.flush();

    expect(payloads[payloads.length - 1]).toBe(3);
    expect(put.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('coalesce：inflight 期间 dirty 会再写一轮', async () => {
    const payloads: number[] = [];
    let state = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let first = true;
    const put = vi.fn(async (p: unknown) => {
      payloads.push(p as number);
      if (first) {
        first = false;
        await gate;
      }
    });
    const q = createSaveQueue({
      getPayload: () => state,
      put,
    });

    state = 1;
    q.request();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    state = 9;
    q.request();
    release();
    await q.flush();

    expect(payloads).toContain(1);
    expect(payloads[payloads.length - 1]).toBe(9);
  });
});

describe('combatPhase round-trip', () => {
  beforeEach(() => seedMinimal());

  it('toSaveData / loadSaveData 保留 battle_pending 快照', () => {
    const eng = new GameEngine();
    eng.state.round = 2;
    eng.syncPhaseFromRound();
    eng.beginBattlePending({
      enemyBd: [{ entity: eng.createItem('human', 'entity'), children: [] }],
      autoWin: false,
    });
    const seed = eng.combatSeed;
    const data = eng.toSaveData();
    expect(data.saveVersion).toBe(4);
    expect(data.combatPhase).toBe('battle_pending');
    expect(data.combatSeed).toBe(seed);
    expect(data.combatRngVersion).toBe(COMBAT_RNG_VERSION);

    const eng2 = new GameEngine();
    eng2.loadSaveData(data);
    expect(eng2.combatPhase).toBe('battle_pending');
    expect(eng2.combatSeed).toBe(seed);
    expect(eng2.resolveCombatResume()).toBe('replay');
  });

  it('本回合已有 battles 时读档为 end_ui', () => {
    const eng = new GameEngine();
    eng.state.round = 2;
    eng.syncPhaseFromRound();
    eng.combatPhase = 'battle_pending';
    eng.combatSeed = 42;
    eng.state.battles.push({
      round: 2,
      result: 'win',
      rewardGold: 5,
      playerBd: [],
      enemyBd: [],
      log: [],
    });
    expect(eng.resolveCombatResume()).toBe('end_ui');
  });
});

describe('combatSeed 确定性', () => {
  it('同 seed 两次 Simulator 结果一致', () => {
    const mkSnap = (id: string, name: string, hp: number, dmg: number): CombatUnitSnapshot => ({
      instanceId: id,
      entityId: id,
      entityName: name,
      totalHp: hp,
      currentHp: hp,
      totalStaminaRegen: 20,
      maxStamina: 100,
      currentStamina: 100,
      staminaRegen: 20,
      totalHpRegeneration: 0,
      currentLoad: 0,
      maxLoad: 50,
      isOverloaded: false,
      slotIndex: 0,
      isStarter: true,
      activeWeapons: [{
        name: `${name}武器`,
        actionTime: 1000,
        damage: dmg,
        staminaCost: 5,
        targetFaction: undefined,
        targetCount: 1,
        targetCondition: { sortBy: '从上往下', filterBy: ['敌人'] },
        ownerInstanceId: id,
        onHitEffects: dmg
          ? [{ displayName: '伤害', kind: 'instant' as const, stat: 'hp' as const, op: 'loss' as const, params: { amount: dmg }, applyTo: ['target' as const] }]
          : [],
      }],
    });

    const run = (seed: number) => {
      const player = buildCombatRuntime([mkSnap('p1', '玩家', 50, 10)]);
      const enemy = buildCombatRuntime([mkSnap('e1', '敌人', 30, 5)]);
      const sim = new BattleSimulator({
        playerUnits: player,
        enemyUnits: enemy,
        playerOnHitEffects: new Map(),
        enemyOnHitEffects: new Map(),
        rng: seededRandom(seed),
      });
      sim.runToEnd();
      return {
        win: sim.resultWin,
        fp: sim.drainEvents().map(eventFingerprint).join('\n'),
      };
    };

    const a = run(123456);
    const b = run(123456);
    expect(a.win).toBe(b.win);
    expect(a.fp).toBe(b.fp);
  });
});
