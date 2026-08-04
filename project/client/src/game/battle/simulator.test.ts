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
});
