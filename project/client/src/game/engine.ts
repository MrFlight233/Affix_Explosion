// ============================================================
// 游戏引擎 — 状态管理、单存档、敌方BD、分步战斗
// ============================================================

import {
  EntityDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, isActionable, genId,
  ActionableEntity, EquipmentEntity, ENTITY_DEFS, AFFIX_DEFS,
} from './data';
import { saves as savesApi } from '../api/client';

export type GamePhase = 1 | 2 | 3;

// ---- 敌方 BD ----

export interface EnemyUnit {
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  armor: number;
  actionTime: number;
  attackType: string;
  attackOrder: string;
  priorityTarget: number | null;
  children: { name: string; damageBonus: number; armorBonus: number; desc: string }[];
}

// ---- 战斗事件 ----

export interface CombatEvent {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  damage: number;
  targetHpAfter: number;
  targetMaxHp: number;
  effects: string[];
}

// ---- 游戏状态 ----

export interface GameState {
  gold: number;
  floor: number;
  round: number;
  phase: GamePhase;
  vitality: number;
  maxVitality: number;
  warehouse: ItemInstance[];
  deploySlots: DeploySlot[];
  itemPool: string[];
  seed: number;
  currentEvents: string[];
  growthStacks: Record<string, number>;
  quickWarehouseCollapsed: boolean;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export class GameEngine {
  state!: GameState;
  username = '';

  onStateChange?: () => void;
  onToast?: (msg: string) => void;
  rightPanel: string | null = null;

  // 战斗相关
  combatSpeed = 1; // 0.5 | 1 | 2
  combatRunning = false;
  combatPaused = false;
  onCombatEvent?: (event: CombatEvent) => void;
  onCombatEnd?: (win: boolean, goldReward: number) => void;

  constructor() { this.resetState(); }

  resetState() {
    this.state = {
      gold: 100, floor: 1, round: 1, phase: 1, vitality: 0, maxVitality: 5,
      warehouse: [], deploySlots: [], itemPool: [], seed: Date.now(),
      currentEvents: [], growthStacks: {}, quickWarehouseCollapsed: false,
    };
    this.rebuildItemPool();
    this.addToWarehouse(this.createItem('adventurer', 'entity'));
    this.rightPanel = null;
    this.notify();
  }

  rebuildItemPool() {
    this.state.itemPool = ENTITY_DEFS.filter(e => e.poolPrerequisite.length === 0).map(e => e.id);
  }

  notify() { this.onStateChange?.(); }
  toast(msg: string) { this.onToast?.(msg); }

  // ---- 物品操作（不变） ----
  createItem(defId: string, type: 'entity' | 'affix'): ItemInstance {
    return { instanceId: genId(), defId, type };
  }
  getDef(item: ItemInstance): EntityDef | any {
    return item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
  }
  addToWarehouse(item: ItemInstance) { this.state.warehouse.push(item); this.notify(); }
  removeFromWarehouse(instanceId: string): ItemInstance | undefined {
    const idx = this.state.warehouse.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return undefined;
    const [item] = this.state.warehouse.splice(idx, 1);
    this.notify(); return item;
  }
  removeFromDeploy(instanceId: string): { slotIdx: number; childIdx: number } | null {
    const si = this.state.deploySlots.findIndex(s => s.entity.instanceId === instanceId);
    if (si !== -1) { this.state.deploySlots.splice(si, 1); this.notify(); return { slotIdx: si, childIdx: -1 }; }
    for (let si = 0; si < this.state.deploySlots.length; si++) {
      const ci = this.state.deploySlots[si].children.findIndex(c => c.instanceId === instanceId);
      if (ci !== -1) { this.state.deploySlots[si].children.splice(ci, 1); this.notify(); return { slotIdx: si, childIdx: ci }; }
    }
    return null;
  }
  findItem(instanceId: string): ItemInstance | undefined {
    let item = this.state.warehouse.find(i => i.instanceId === instanceId);
    if (item) return item;
    for (const slot of this.state.deploySlots) {
      if (slot.entity.instanceId === instanceId) return slot.entity;
      item = slot.children.find(c => c.instanceId === instanceId);
      if (item) return item;
    }
    return undefined;
  }
  canEquipToSlot(slotIdx: number, childDef: EntityDef): string | null {
    const slot = this.state.deploySlots[slotIdx];
    if (!slot) return '槽位不存在';
    const p = getEntityDef(slot.entity.defId);
    if (!p || p.kind !== 'actionable') return '只能装备到可行动实体上';
    if (childDef.kind === 'actionable' && childDef.fixedAffixes.includes('actionable'))
      return '可行动实体不能放入其他实体的槽位';
    const used = slot.children.reduce((s, c) => s + ((getEntityDef(c.defId) as any)?.slotCost || 1), 0);
    if (childDef.slotCost > p.entitySlots - used)
      return `槽位不足(剩${p.entitySlots - used},需${childDef.slotCost})`;
    return null;
  }
  getVitalityUsed(): number {
    let t = 0;
    for (const s of this.state.deploySlots) {
      const d = getEntityDef(s.entity.defId);
      if (d) for (const a of d.fixedAffixes) {
        if (a === 'vitality1') t += 1; else if (a === 'vitality2') t += 2; else if (a === 'vitality3') t += 3;
      }
    }
    this.state.vitality = t; return t;
  }

  // ---- 拖拽操作 ----
  moveToDeploy(item: ItemInstance, targetSlotIdx?: number): string | null {
    const def = this.getDef(item); if (!def) return '未知物品';
    if (item.type === 'entity') {
      const edef = def as EntityDef;
      if (edef.kind === 'actionable') {
        if (targetSlotIdx !== undefined) return '可行动实体只能放在第一层级';
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        this.state.deploySlots.push({ entity: item, children: [] });
        this.notify(); return null;
      } else {
        if (targetSlotIdx === undefined) return '装备需放入可行动实体的槽位';
        const err = this.canEquipToSlot(targetSlotIdx, edef); if (err) return err;
        this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
        this.state.deploySlots[targetSlotIdx].children.push(item);
        this.notify(); return null;
      }
    }
    if (item.type === 'affix') {
      if (targetSlotIdx === undefined) return '词条需放入实体槽位';
      this.removeFromWarehouse(item.instanceId); this.removeFromDeploy(item.instanceId);
      this.state.deploySlots[targetSlotIdx].children.push(item);
      this.notify(); return null;
    }
    return '无法放置';
  }
  moveToWarehouse(item: ItemInstance) {
    this.removeFromDeploy(item.instanceId); this.state.warehouse.push(item); this.notify();
  }
  sellItem(item: ItemInstance): number | null {
    const def = this.getDef(item); if (!def) return null;
    const bv = 'costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value;
    const price = Math.max(Math.floor(bv / 2), 1);
    const wi = this.state.warehouse.findIndex(i => i.instanceId === item.instanceId);
    if (wi !== -1) { this.state.warehouse.splice(wi, 1); this.state.gold += price; this.notify(); return price; }
    const r = this.removeFromDeploy(item.instanceId);
    if (r) { this.state.gold += price; this.notify(); return price; }
    return null;
  }
  buyItem(item: ItemInstance): string | null {
    const def = this.getDef(item);
    const price = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price; this.addToWarehouse(item); return null;
  }
  buyAndEquip(item: ItemInstance, targetSlotIdx?: number): string | null {
    const def = this.getDef(item);
    const price = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
    if (this.state.gold < price) return `金币不足(需${price},有${this.state.gold})`;
    this.state.gold -= price;
    const ni = this.createItem(item.defId, item.type);
    return this.moveToDeploy(ni, targetSlotIdx);
  }

  // 排序
  moveDeploySlot(from: number, to: number) {
    if (from === to) return; const [s] = this.state.deploySlots.splice(from, 1);
    this.state.deploySlots.splice(to, 0, s); this.notify();
  }
  moveWarehouseItem(from: number, to: number) {
    if (from === to) return; const [item] = this.state.warehouse.splice(from, 1);
    this.state.warehouse.splice(to, 0, item); this.notify();
  }

  // ---- 阶段 ----
  getPhaseLabel(): string {
    const p = ['', '探险', '战斗', '收集'];
    return `${this.state.floor}-${this.state.round}-${this.state.phase} ${p[this.state.phase]}阶段`;
  }
  getMerchantValueCap(): number { return this.state.round * 10; }

  nextPhase() {
    if (this.state.phase === 1) {
      this.state.phase = 2;
    } else if (this.state.phase === 2) {
      this.state.phase = 3;
    } else if (this.state.phase === 3) {
      if (this.state.round >= 3) { this.state.floor++; this.state.round = 1; }
      else { this.state.round++; }
      this.state.phase = 1;
      this.generateEvents();
      this.autoSave();
    }
    this.notify();
  }

  // ---- 事件 ----
  generateEvents() {
    const evts = ['good_merchant', 'entity_merchant', 'affix_merchant', 'discount_merchant', 'lottery'];
    const rand = seededRandom(this.state.seed + this.state.round * 100 + this.state.phase);
    const picked: string[] = [], pool = [...evts];
    for (let i = 0; i < 3 && pool.length > 0; i++)
      picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    this.state.currentEvents = picked;
  }
  getEventName(id: string): string {
    const n: Record<string,string> = { good_merchant:'好物商人', entity_merchant:'实体好物商人',
      affix_merchant:'词条好物商人', discount_merchant:'折扣商人', lottery:'抽奖' };
    return n[id] || id;
  }

  // ---- 敌方 BD 生成 ----
  generateEnemyBD(): EnemyUnit[] {
    const r = this.state.round;
    const rand = seededRandom(this.state.seed + r * 777);
    const enemies: EnemyUnit[] = [];
    const count = r === 1 ? 1 : r === 2 ? 2 : 3;

    const enemyTemplates = [
      { name: '重装步兵', hpBase: 25, dmgBase: 3, armBase: 5, atk: '近战', ao: '从上往下', pt: 1 as number | null },
      { name: '哥布林战士', hpBase: 15, dmgBase: 5, armBase: 1, atk: '近战', ao: '从上往下', pt: 1 as number | null },
      { name: '哥布林弓手', hpBase: 12, dmgBase: 6, armBase: 0, atk: '远程', ao: '从下往上', pt: null as number | null },
      { name: '骷髅法师', hpBase: 10, dmgBase: 8, armBase: 0, atk: '远程', ao: '从下往上', pt: 2 as number | null },
      { name: '暗影刺客', hpBase: 14, dmgBase: 7, armBase: 1, atk: '近战', ao: '从上往下', pt: 1 as number | null },
    ];

    for (let i = 0; i < count; i++) {
      const t = enemyTemplates[Math.floor(rand() * enemyTemplates.length)];
      const mult = 1 + (r - 1) * 0.7;
      const hp = Math.floor(t.hpBase * mult * (0.8 + rand() * 0.4));
      const dmg = Math.floor(t.dmgBase * mult * (0.8 + rand() * 0.4));
      const arm = Math.floor(t.armBase * mult * 0.8);
      const at = 2000 + Math.floor(rand() * 1500);

      enemies.push({
        name: `${t.name} Lv${r}`, hp, maxHp: hp, damage: dmg, armor: arm,
        actionTime: at, attackType: t.atk, attackOrder: t.ao, priorityTarget: t.pt,
        children: [],
      });
    }

    // 给敌人随机装备
    const weaponNames = ['生锈短剑', '猎弓', '木盾', '骨杖'];
    for (const e of enemies) {
      if (rand() > 0.5) {
        const wn = weaponNames[Math.floor(rand() * weaponNames.length)];
        const db = Math.floor(2 + rand() * 4);
        const ab = wn === '木盾' ? Math.floor(2 + rand() * 3) : 0;
        e.children.push({ name: wn, damageBonus: db, armorBonus: ab, desc: wn === '木盾' ? `护甲+${ab}` : `伤害+${db}` });
        e.damage += db;
        e.armor += ab;
      }
    }

    return enemies;
  }

  // ---- 分步战斗 ----
  calculatePlayerPower(): { totalDmg: number; totalHp: number } {
    let dmg = 0, hp = 0;
    for (const slot of this.state.deploySlots) {
      const edef = getEntityDef(slot.entity.defId) as ActionableEntity | undefined;
      if (!edef) continue;
      dmg += edef.baseDamage; hp += edef.hp;
      for (const child of slot.children) {
        if (child.type === 'entity') {
          const cdef = getEntityDef(child.defId) as EquipmentEntity | undefined;
          if (cdef) { dmg += cdef.damageBonus; hp += cdef.hpBonus; dmg += cdef.armorBonus * 0.5; }
        }
        if (child.type === 'affix') {
          const adef = getAffixDef(child.defId);
          if (adef?.id === 'strength') dmg += adef.value;
          if (adef?.id === 'armor_boost') dmg += adef.value * 0.5;
        }
      }
      dmg += this.state.growthStacks[slot.entity.instanceId] || 0;
    }
    return { totalDmg: Math.round(dmg), totalHp: Math.max(hp, 10) };
  }

  async runCombat(
    onEvent: (evt: CombatEvent) => void,
    onEnd: (win: boolean, gold: number) => void,
    speed: number,
  ) {
    const enemies = this.generateEnemyBD();
    const pwr = this.calculatePlayerPower();
    const rand = seededRandom(this.state.seed + this.state.round * 999);

    // 计算敌我战力
    let playerHp = pwr.totalHp;
    const playerDmg = pwr.totalDmg;
    let enemyUnits = enemies.map(e => ({ ...e }));

    const speedMs = Math.round(1000 / speed); // 1x=1000ms, 2x=500ms, 0.5x=2000ms
    let time = 0;
    let round = 0;

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 主循环
    while (playerHp > 0 && enemyUnits.some(e => e.hp > 0) && round < 100) {
      round++; time += 1000;

      // 玩家攻击
      const target = enemyUnits.find(e => e.hp > 0);
      if (target) {
        const rawDmg = playerDmg * (0.8 + rand() * 0.4);
        const phyDmg = Math.max(Math.floor(rawDmg - target.armor * 0.5), 1);
        target.hp -= phyDmg;

        const evt: CombatEvent = {
          time, actorName: '玩家', weaponName: '攻击',
          targetName: target.name, damage: phyDmg,
          targetHpAfter: Math.max(target.hp, 0), targetMaxHp: target.maxHp,
          effects: phyDmg >= target.maxHp * 0.3 ? ['重击'] : [],
        };
        onEvent(evt);
        await delay(speedMs);

        if (target.hp <= 0) {
          onEvent({ time, actorName: '', weaponName: '', targetName: target.name,
            damage: 0, targetHpAfter: 0, targetMaxHp: target.maxHp, effects: ['击杀'] });
          await delay(speedMs / 2);
        }
      }

      // 敌人攻击
      for (const e of enemyUnits) {
        if (e.hp <= 0) continue;
        const rawDmg = e.damage * (0.7 + rand() * 0.3);
        const edmg = Math.max(Math.floor(rawDmg), 1);
        playerHp -= edmg;

        const evt: CombatEvent = {
          time: time + 500, actorName: e.name, weaponName: '攻击',
          targetName: '玩家', damage: edmg,
          targetHpAfter: Math.max(playerHp, 0), targetMaxHp: pwr.totalHp,
          effects: [],
        };
        onEvent(evt);
        await delay(speedMs);

        if (playerHp <= 0) break;
      }
    }

    const win = playerHp > 0;
    const goldReward = win ? (10 + this.state.round * 5 + this.state.deploySlots.length * 2) : 0;

    if (win) {
      for (const slot of this.state.deploySlots) {
        const hasGrowth = slot.children.some(c => c.type === 'affix' && c.defId === 'growth');
        if (hasGrowth) {
          const cur = this.state.growthStacks[slot.entity.instanceId] || 0;
          if (cur < 10) this.state.growthStacks[slot.entity.instanceId] = cur + 1;
        }
      }
      this.state.gold += goldReward;
    }

    this.notify();
    onEnd(win, goldReward);
    return { win, enemies, goldReward };
  }

  // ---- 存档（单存档，无槽位） ----
  toSaveData(): any {
    return {
      gold: this.state.gold, floor: this.state.floor, round: this.state.round,
      phase: this.state.phase, maxVitality: this.state.maxVitality,
      warehouse: this.state.warehouse, deploySlots: this.state.deploySlots,
      itemPool: this.state.itemPool, seed: this.state.seed,
      growthStacks: this.state.growthStacks, savedAt: new Date().toISOString(),
    };
  }

  loadSaveData(data: any) {
    this.state.gold = data.gold ?? 100; this.state.floor = data.floor ?? 1;
    this.state.round = data.round ?? 1; this.state.phase = data.phase ?? 1;
    this.state.maxVitality = data.maxVitality ?? 5;
    this.state.warehouse = data.warehouse ?? []; this.state.deploySlots = data.deploySlots ?? [];
    this.state.itemPool = data.itemPool ?? []; this.state.seed = data.seed ?? Date.now();
    this.state.growthStacks = data.growthStacks ?? {}; this.state.currentEvents = [];
    if (this.state.phase === 1) this.generateEvents();
    this.getVitalityUsed(); this.notify();
  }

  async autoSave() {
    try { await savesApi.put(this.toSaveData()); } catch (e) { console.warn('自动存档失败'); }
  }

  async manualSave() {
    await savesApi.put(this.toSaveData());
  }

  async hasSave(): Promise<boolean> {
    try { const d = await savesApi.list(); return d.save !== null; } catch { return false; }
  }

  async loadLatestSave(): Promise<boolean> {
    try {
      const d = await savesApi.list();
      if (!d.save) return false;
      this.loadSaveData(JSON.parse(d.save.data_json));
      return true;
    } catch { return false; }
  }
}
