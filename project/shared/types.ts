// ============================================================
// Affix Explosion — 前后端共享类型定义
// ============================================================

// ---- 枚举 ----

export type EntityCategory = '角色' | '武器' | '防具' | '饰品' | '随从' | '容器';
export type AttackType = '近战' | '远程';
/** 顺序攻击 — 优先目标位不存在时的兜底搜索方向 */
export type AttackOrder = '从上往下' | '从下往上';
/** 优先目标位 — 优先攻击敌方第几位（1-based），null = 无优先 */
export type PriorityTarget = 1 | 2 | 3 | null;
export type AffixCategory = '属性' | '行动' | '伤害' | '防御' | '耐力' | '负重' | '容器' | '限制' | '特殊';
export type AffixTarget = '可行动实体' | '装备实体' | '通用';
export type GamePhase = 1 | 2 | 3; // 1=探险 2=战斗 3=收集

// ---- 实体 ----

export interface ActionableEntity {
  kind: 'actionable';
  id: string;
  name: string;
  category: '角色' | '随从';
  slotCost: number;
  entitySlots: number;
  hp: number;
  maxStamina: number;
  staminaRegen: number;
  maxLoad: number;
  attackType: AttackType;
  attackOrder: AttackOrder;
  priorityTarget: PriorityTarget;
  baseDamage: number;
  baseArmor: number;
  baseRegen: number;
  baseActionTime: number;
  value: number;
  fixedAffixes: string[];
  dynamicAffixSlots: number;
  poolPrerequisite: string[];
}

export interface EquipmentEntity {
  kind: 'equipment';
  id: string;
  name: string;
  category: '武器' | '防具' | '饰品' | '容器';
  slotCost: number;
  entitySlots: number;
  weight: number;
  isActive: boolean;
  staminaCost: number;
  attackType: AttackType | null;
  attackOrder: AttackOrder | null;
  priorityTarget: PriorityTarget;
  damageBonus: number;
  armorBonus: number;
  regenBonus: number;
  actionTimeMod: number;
  hpBonus: number;
  value: number;
  fixedAffixes: string[];
  dynamicAffixSlots: number;
  poolPrerequisite: string[];
}

export type Entity = ActionableEntity | EquipmentEntity;

// ---- 词条 ----

export interface AffixDef {
  id: string;
  name: string;
  category: AffixCategory;
  value: number;
  costValue: number;
  slotCost: number;
  repeatable: boolean;
  prerequisite: string[];
  poolPrerequisite: string[];
  target: AffixTarget;
  effect: string;
}

// ---- 物品实例（带实例 ID） ----

export interface ItemInstance {
  instanceId: string;
  defId: string;
  type: 'entity' | 'affix';
  dynamicValue: number;
  affixes: string[];  // 附加在该物品上的词条 defId 列表
}

// ---- 出场槽位 ----

export interface DeploySlot {
  entity: ItemInstance;          // 可行动实体实例
  children: ItemInstance[];      // 子孙装备 + 词条
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
}

// ---- 战斗 ----

export interface CombatUnitSnapshot {
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  totalArmor: number;
  totalDamage: number;
  totalRegen: number;
  dynamicActionTime: number;
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
  currentLoad: number;
  maxLoad: number;
  isOverloaded: boolean;
  attackType: AttackType;
  attackOrder: AttackOrder;
  priorityTarget: PriorityTarget;
  activeWeapons: {
    name: string;
    damageBonus: number;
    staminaCost: number;
    attackType: AttackType;
    attackOrder: AttackOrder;
    priorityTarget: PriorityTarget;
  }[];
}

export interface CombatEvent {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  physicalDamage: number;
  fireDamage: number;
  poisonDamage: number;
  totalDamage: number;
  effects: string[];
  actorHpAfter: number;
  targetHpAfter: number;
}

export interface CombatResult {
  win: boolean;
  events: CombatEvent[];
  duration: number;
  rewards: {
    gold: number;
    items: ItemInstance[];
  };
}

// ---- API ----

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: { id: number; username: string };
}

export interface SaveSlotData {
  slot: number;
  data_json: string;
  updated_at: string;
}

export interface BattlePoolEntry {
  id: number;
  username: string;
  floor: number;
  round: number;
  bd_json: string;
  power_score: number;
}
