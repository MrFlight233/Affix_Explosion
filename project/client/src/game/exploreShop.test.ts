import './testLocalStorage';
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './engine';
import { reloadData, getEffectiveEntitySlots, computeStarterLoad, type EntityDef, type AffixDef } from './data';

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
    {
      id: 'sword', name: '剑', slotCost: 1, entitySlots: 0, weight: 10, value: 8,
      fixedAffixes: [], dynamicAffixSlots: 0, poolPrerequisite: [],
      hp: 0, maxStamina: 0, staminaRegen: 0, hpRegen: 0, maxLoad: 0,
      isActive: true, staminaCost: 5, actionTime: 800, damage: 10,
      targetType: null, targetOrder: null, priorityTarget: null, targetFaction: 'enemy',
      staminaRegenerationBonus: 0, staminaBonus: 0, hpRegenerationBonus: 0, hpBonus: 0,
    },
    {
      id: 'smuggle_ent', name: '走私货', slotCost: 1, entitySlots: 0, weight: 1, value: 25,
      fixedAffixes: [], dynamicAffixSlots: 0, poolPrerequisite: [],
      hp: 0, maxStamina: 0, staminaRegen: 0, hpRegen: 0, maxLoad: 0,
      isActive: false, staminaCost: 0, actionTime: 0, damage: 0,
      targetType: null, targetOrder: null, priorityTarget: null, targetFaction: null,
      staminaRegenerationBonus: 0, staminaBonus: 0, hpRegenerationBonus: 0, hpBonus: 0,
    },
  ] as unknown as EntityDef[];
  const affixes = [
    {
      id: 'aff1', name: '词条A', category: 'misc', costValue: 3, slotCost: 1, value: 3,
      repeatable: true, prerequisite: [], poolPrerequisite: [], effect: '',
      onHitEffects: [], staminaRegenerationBonus: 0, staminaBonus: 0,
      hpRegenerationBonus: 0, hpBonus: 0, loadBonus: 0,
    },
  ] as unknown as AffixDef[];
  reloadData(entities, affixes, []);
}

describe('explore shop + reserve', () => {
  let eng: GameEngine;
  beforeEach(() => {
    seedMinimal();
    eng = new GameEngine();
  });

  it('开局进入探险：现金含探险发放静默结算，货架有实体', () => {
    expect(eng.state.gold).toBe(50);
    expect(eng.state.reserveGold).toBe(0);
    expect(eng.state.shopOffers.length).toBeGreaterThan(0);
    expect(eng.state.currentEvents).toContain('hire');
  });

  it('刷新费 2,4,6…', () => {
    expect(eng.getShopRefreshCost()).toBe(2);
    const g0 = eng.state.gold;
    const err = eng.refreshShop();
    expect(err).toBeNull();
    expect(eng.state.gold).toBe(g0 - 2);
    expect(eng.getShopRefreshCost()).toBe(4);
  });

  it('买一次从货架移除', () => {
    const item = eng.state.shopOffers.find(i => i.type === 'entity');
    expect(item).toBeTruthy();
    const n = eng.state.shopOffers.length;
    const err = eng.buyFromShopOffer(item!);
    expect(err).toBeNull();
    expect(eng.state.shopOffers.length).toBe(n - 1);
    expect(eng.state.warehouse.some(w => w.instanceId === item!.instanceId)).toBe(true);
  });

  it('胜奖入备用池；进下一探险静默结算', () => {
    eng.state.round = 2;
    eng.syncPhaseFromRound();
    const win = eng.getBattleWinGold();
    eng.addReserve(win);
    expect(eng.state.reserveGold).toBe(win);
    const goldBefore = eng.state.gold;
    const next = eng.continueAfterBattle();
    expect(next).toBe('explore');
    expect(eng.state.round).toBe(3);
    const exploreGrant = Math.floor((3 + 1) / 2) * 10;
    expect(eng.state.reserveGold).toBe(0);
    expect(eng.state.gold).toBe(goldBefore + win + exploreGrant);
  });

  it('投资：扣现金加备用池', () => {
    eng.state.currentEvents = ['invest'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('invest');
    const g0 = eng.state.gold;
    const err = eng.doInvestEvent();
    expect(err).toBeNull();
    expect(eng.state.gold).toBe(g0 - 10);
    expect(eng.state.reserveGold).toBe(20);
    expect(eng.state.eventStatus).toBe('done');
  });

  it('工匠强化 hp', () => {
    const human = eng.createItem('human', 'entity');
    eng.addToWarehouse(human);
    eng.state.currentEvents = ['craftsman'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('craftsman');
    expect(eng.moveEntityToCraftsman(human)).toBeNull();
    expect(eng.applyCraftsmanUpgrade('hp')).toBeNull();
    const back = eng.state.warehouse.find(w => w.instanceId === human.instanceId)
      || eng.state.deploySlots.find(s => s.entity.instanceId === human.instanceId)?.entity;
    expect(back).toBeTruthy();
    expect(Number((back!.overrides as any)?.hp)).toBe(200);
  });

  it('工匠强化子实体槽写入 overrides 且可读', () => {
    const human = eng.createItem('human', 'entity');
    eng.addToWarehouse(human);
    eng.state.currentEvents = ['craftsman'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('craftsman');
    expect(eng.moveEntityToCraftsman(human)).toBeNull();
    const before = getEffectiveEntitySlots(human);
    expect(eng.applyCraftsmanUpgrade('entitySlots')).toBeNull();
    const back = eng.state.warehouse.find(w => w.instanceId === human.instanceId)!;
    expect(Number(back.overrides?.entitySlots)).toBe(before + 1);
    expect(getEffectiveEntitySlots(back)).toBe(before + 1);
  });

  it('工匠强化 hp/耐力上限进入战斗快照', () => {
    const human = eng.createItem('human', 'entity');
    eng.addToWarehouse(human);
    eng.state.currentEvents = ['craftsman'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('craftsman');
    expect(eng.moveEntityToCraftsman(human)).toBeNull();
    expect(eng.applyCraftsmanUpgrade('hp')).toBeNull();
    const back = eng.state.warehouse.find(w => w.instanceId === human.instanceId)!;
    eng.state.warehouse = [];
    eng.state.deploySlots = [{ entity: back, children: [] }];
    const { snapshots } = eng.calculateCombatSnapshots();
    expect(snapshots[0].totalHp).toBe(200);
  });

  it('工匠强化负重上限反映在 computeStarterLoad', () => {
    const human = eng.createItem('human', 'entity');
    eng.addToWarehouse(human);
    eng.state.currentEvents = ['craftsman'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('craftsman');
    expect(eng.moveEntityToCraftsman(human)).toBeNull();
    const before = computeStarterLoad(human).max;
    expect(eng.applyCraftsmanUpgrade('maxLoad')).toBeNull();
    const back = eng.state.warehouse.find(w => w.instanceId === human.instanceId)!;
    expect(computeStarterLoad(back).max).toBe(before + 10000);
  });

  it('工匠可 extract 后换实体', () => {
    const a = eng.createItem('human', 'entity');
    const b = eng.createItem('sword', 'entity');
    eng.addToWarehouse(a);
    eng.addToWarehouse(b);
    eng.state.currentEvents = ['craftsman'];
    eng.state.eventStatus = 'pending';
    eng.beginEvent('craftsman');
    expect(eng.moveEntityToCraftsman(a)).toBeNull();
    const taken = eng.extractCraftsmanItem();
    expect(taken?.instanceId).toBe(a.instanceId);
    expect(eng.state.craftsmanSlot).toBeNull();
    eng.addToWarehouse(taken!);
    expect(eng.moveEntityToCraftsman(b)).toBeNull();
    expect(eng.state.craftsmanSlot?.instanceId).toBe(b.instanceId);
  });
});
