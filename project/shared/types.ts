// ============================================================
// Affix Explosion — 前后端共享类型定义
// ============================================================

// ---- 枚举 ----

export type AttackType = '近战' | '远程';
/** 顺序攻击 — 优先目标位不存在时的兜底搜索方向 */
export type AttackOrder = '从上往下' | '从下往上';
/** 优先目标位 — 优先攻击敌方第几位（1-based），null = 无优先 */
export type PriorityTarget = 1 | 2 | 3 | null;
export type AffixCategory = '属性' | '行动' | '伤害' | '防御' | '耐力' | '负重' | '容器' | '限制' | '特殊';
export type AffixTarget = '启动端' | '装备' | '通用';
export type GamePhase = 1 | 2 | 3; // 1=探险 2=战斗 3=收集

// ---- 统一实体定义（v3：启动端/装备统一模型） ----

/** 子实体规格：引用模板 + 可选字段覆写 */
export interface DefaultChildSpec {
  /** 引用的实体模板 ID */
  defId: string;
  /** 按需覆写的字段，只存与模板的差异。未指定的字段使用模板默认值 */
  overrides?: Partial<EntityDef>;
}

export interface EntityDef {
  // ---- 共享字段（所有实体都有） ----
  // 分类由 fixedAffixes 推导（follower/weapon_type/armor_type/accessory_type/container1-4）
  id: string;
  name: string;
  slotCost: number;
  entitySlots: number;
  /** 装备: 重量（计入父启动端负重）; 启动端: 0 */
  weight: number;
  value: number;
  fixedAffixes: string[];
  dynamicAffixSlots: number;
  poolPrerequisite: string[];
  /** 创建该实体时自动生成的子装备列表。字符串 = 纯模板引用; { defId, overrides? } = 带覆写 */
  defaultChildren?: (string | DefaultChildSpec)[];

  // ---- 启动端字段（fixedAffixes 含 'starter' 时有效，否则为 0） ----
  /** 启动端: 基础HP; 装备: 始终为 0 */
  hp: number;
  maxStamina: number;
  staminaRegen: number;   // 每秒
  maxLoad: number;

  // ---- 主动装备字段（isActive=true 时有效） ----
  /** 启动端始终为 false */
  isActive: boolean;
  staminaCost: number;
  /** 主动装备: 绝对毫秒值; 启动端/被动装备: 0 */
  actionTime: number;
  /** 主动装备: 每次触发伤害; 被动装备: 全局伤害加成（加至所有主动武器）; 启动端: 始终为 0 */
  damage: number;
  attackType: string | null;    // '近战'|'远程'
  attackOrder: string | null;   // '从上往下'|'从下往上'
  priorityTarget: number | null; // 1|2|3|null

  // ---- 被动加成（对父启动端生效） ----
  /** 被动加成: 护甲; 启动端: 始终为 0 */
  armorBonus: number;
  /** 被动加成: 回复/秒; 启动端: 始终为 0 */
  regenBonus: number;
  /** 装备: 分配给父启动端的 HP 加成; 启动端: 始终为 0 */
  hpBonus: number;
}

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
  /** 容器实体的嵌套子项（实体 + 词条），递归支持多层嵌套 */
  children?: ItemInstance[];
  /** 实例级字段覆写 — 覆盖 EntityDef 模板值。用于 defaultChildren 差异化创建 */
  overrides?: Partial<EntityDef>;
}

// ---- 出场槽位 ----

export interface DeploySlot {
  entity: ItemInstance;          // 启动端实体实例
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

// ---- 战斗（v3：启动端+武器独立触发模型） ----

export interface CombatUnitSnapshot {
  // 启动端自身
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  totalArmor: number;       // 基础护甲 + 所有被动装备 armorBonus 之和
  totalRegen: number;       // 基础恢复 + 所有被动装备 regenBonus 之和
  maxStamina: number;
  currentStamina: number;
  staminaRegen: number;
  currentLoad: number;
  maxLoad: number;
  isOverloaded: boolean;

  // 主动武器列表（每件独立在时间线上触发）
  activeWeapons: {
    name: string;
    actionTime: number;     // 绝对毫秒，固定值
    damage: number;          // 武器自身伤害 + 被动装备 damage 加成
    staminaCost: number;
    attackType: string;      // '近战' | '远程'
    attackOrder: string;     // '从上往下' | '从下往上'
    priorityTarget: number | null; // 1|2|3|null
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
