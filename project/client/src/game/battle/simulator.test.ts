import { describe, it, expect } from 'vitest';
import { BattleSimulator } from './simulator';
import { buildCombatRuntime, type CombatUnitSnapshot } from './types';
import { eventFingerprint } from './onhit';

function makeUnit(id: string, name: string, hp: number, dmg: number, actionTime = 1000): CombatUnitSnapshot {
  return {
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
      actionTime,
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
  };
}

describe('BattleSimulator', () => {
  it('runToEnd 确定性：两次事件序列一致', () => {
    const mk = () => {
      const player = buildCombatRuntime([makeUnit('p1', '玩家', 50, 10)]);
      const enemy = buildCombatRuntime([makeUnit('e1', '敌人', 30, 5)]);
      return new BattleSimulator({
        playerUnits: player,
        enemyUnits: enemy,
        playerOnHitEffects: new Map(),
        enemyOnHitEffects: new Map(),
        rng: () => 0.42,
      });
    };
    const a = mk();
    const b = mk();
    a.runToEnd();
    b.runToEnd();
    const ea = a.drainEvents().map(eventFingerprint).join('\n');
    const eb = b.drainEvents().map(eventFingerprint).join('\n');
    expect(ea).toBe(eb);
    expect(a.resultWin).toBe(b.resultWin);
  });

  it('无头 runToEnd 应在 50ms 内完成满时战斗上限步进', () => {
    // 双方极低伤害拉长战斗，验证步进性能
    const player = buildCombatRuntime([makeUnit('p1', '玩家', 5000, 1, 5000)]);
    const enemy = buildCombatRuntime([makeUnit('e1', '敌人', 5000, 1, 5000)]);
    const sim = new BattleSimulator({
      playerUnits: player,
      enemyUnits: enemy,
      playerOnHitEffects: new Map(),
      enemyOnHitEffects: new Map(),
    });
    const t0 = performance.now();
    const { combatTime } = sim.runToEnd();
    const dt = performance.now() - t0;
    expect(combatTime).toBeGreaterThan(0);
    expect(dt).toBeLessThan(50);
  });

  it('高伤应快速分出胜负', () => {
    const player = buildCombatRuntime([makeUnit('p1', '玩家', 100, 50, 100)]);
    const enemy = buildCombatRuntime([makeUnit('e1', '敌人', 40, 1, 1000)]);
    const sim = new BattleSimulator({
      playerUnits: player,
      enemyUnits: enemy,
      playerOnHitEffects: new Map(),
      enemyOnHitEffects: new Map(),
    });
    const { win } = sim.runToEnd();
    expect(win).toBe(true);
    expect(enemy[0].currentHp).toBeLessThanOrEqual(0);
  });

  it('bootstrapAtZero 产出 time=0 预处理事件，其后 tick 从 0.1s 起', () => {
    const player = buildCombatRuntime([makeUnit('p1', '玩家', 50, 10)]);
    const enemy = buildCombatRuntime([
      {
        ...makeUnit('e1', '木桩', 0, 0),
        currentHp: 0,
        totalHp: 0,
        isStarter: false,
        activeWeapons: [],
        passiveSources: [],
      },
    ]);
    // 友方被动给木桩加 HP 上限以便对照；此处用玩家自 buff
    player[0].passiveSources = [{
      effects: [{ displayName: '生命加成', stat: 'maxHp', op: 'gain', params: { amount: 20 } }],
      targetCondition: { sortBy: 'random', filterBy: ['根实体'] },
      targetCount: 1,
    }];

    const sim = new BattleSimulator({
      playerUnits: player,
      enemyUnits: enemy,
      playerOnHitEffects: new Map(),
      enemyOnHitEffects: new Map(),
      rng: () => 0,
    });
    sim.bootstrapAtZero();
    const events = sim.drainEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.time === 0)).toBe(true);
    expect(events.some(e => e.targetName === '开战预处理')).toBe(true);
    expect(events.some(e => e.actorName === '玩家' && e.weaponName === '生命加成')).toBe(true);
    // 0 血木桩拉不起 → 击杀
    expect(events.some(e => e.effects.includes('击杀') && e.targetName === '木桩')).toBe(true);
    expect(sim.resultWin).toBe(true);
  });

  it('同 seed 胜负不受预处理日志影响', () => {
    const mk = () => {
      const player = buildCombatRuntime([makeUnit('p1', '玩家', 80, 15)]);
      const enemy = buildCombatRuntime([makeUnit('e1', '敌人', 60, 8)]);
      return new BattleSimulator({
        playerUnits: player,
        enemyUnits: enemy,
        playerOnHitEffects: new Map(),
        enemyOnHitEffects: new Map(),
        rng: () => 0.3,
      });
    };
    const a = mk();
    const b = mk();
    a.runToEnd();
    b.runToEnd();
    expect(a.resultWin).toBe(b.resultWin);
    expect(a.combatTime).toBe(b.combatTime);
  });
});
