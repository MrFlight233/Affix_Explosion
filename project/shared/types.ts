// ============================================================
// Affix Explosion — 前后端共享类型定义
// ============================================================
//
// 关系模型（v5：完整梳理）
// ======================
//
// 1. 实体 ↔ 实体嵌套关系（Parent-Child Composition）
//    - 父实体通过 entitySlots（槽位容量）+ children (ItemInstance[])
//      容纳子实体
//    - 模板层：EntityDef.defaultChildren 指定出厂默认子实体
//      类型：(string | DefaultChildSpec)[]
//    - 实例层：ItemInstance.children 保存运行时嵌套
//    - 槽位限制：slotCost（子实体占位数）vs 父实体 entitySlots
//    - 递归：子实体可继续嵌套
//
// 2. 实体 ↔ 词条关系（Entity-Affix Binding）
//    2a. 固定词条（Fixed Affixes）：
//        - EntityDef.fixedAffixes: string[]
//        - 在实体定义时硬绑定，创建实例时自动附带
//        - 用于实体分类（follower/weapon_type/armor_type/accessory_type）
//          和被动属性（vitalityN, starter）
//        - DefaultChildSpec.fixedAffixes 可为子实体附加额外固定词条（合并去重）
//    2b. 动态词条槽位（Dynamic Affix Slots）：
//        - EntityDef.dynamicAffixSlots: number
//        - 创建实例后由玩家手动挂载词条到槽位
//        - 运行时：affix 类型的 ItemInstance 挂载到 entity 的 children 中
//        - DefaultChildSpec.preloadedDynamicAffixes 可预设出厂自带动态词条
//    2c. 词条分类：
//        - AffixDef.category: string — 动态分类，由 categories 表驱动
//        - 分类为 entity_class 的词条用于标记实体类型
//
// 3. 词条 ↔ 词条关系（Affix Dependency Chain）
//    3a. 前置依赖（prerequisite）：
//        - AffixDef.prerequisite: string[]
//        - 同一实体必须已拥有前置词条才能挂载当前词条
//        - 形成线性依赖链
//    3b. 池解锁（poolPrerequisite）：
//        - AffixDef.poolPrerequisite: string[] | EntityDef.poolPrerequisite: string[]
//        - 全局物品池中必须先解锁前置条件才会出现此物品
//        - 用于控制游戏进度中的物品出现顺序
//
// 4. Template/Instance 分离设计
//    - EntityDef / AffixDef = 模板（Template），定义默认值
//    - ItemInstance = 实例（Instance），通过 overrides 按需差异化
//    - createItem(defId, type, overrides?) 创建实例，合并模板与覆写
//    - getEffectiveValue(item, field) 读取有效值（overrides > 模板）
//    - DefaultChildSpec 是模板层的实例化指令：引用模板 + 覆写 + 词条预设

// ---- 枚举 ----

/** @deprecated */
export type TargetType = '近战' | '远程';
/** @deprecated 已并入 TargetSortBy */
export type TargetOrder = '从上往下' | '从下往上';
/** 针对目标 */
export type TargetFaction = '友方' | '敌人' | '所有' | '自己';
/** @deprecated 已并入 sortBy 站位k */
export type PriorityTarget = 1 | 2 | 3 | 4 | 5 | null;

export type TargetSortBy =
  | '从上往下' | '从下往上'
  | '站位1' | '站位2' | '站位3' | '站位4' | '站位5' | '站位中间'
  | 'hp_asc' | 'hp_desc' | 'hp_pct_asc' | 'hp_pct_desc'
  | 'stamina_asc' | 'stamina_desc' | 'stamina_pct_asc' | 'stamina_pct_desc'
  | 'random' | null;

export type TargetFilterBy = string | null;

export interface TargetCondition {
  sortBy?: TargetSortBy;
  filterBy?: string | string[] | null;
  targetCount?: number | 'all' | null;
  /** @deprecated */
  fallback?: string;
}

export interface TargetingModifier {
  targetFaction?: TargetFaction | null;
  /** @deprecated */
  targetOrder?: string | null;
  /** @deprecated */
  priorityTarget?: number | null;
  sortBy?: TargetSortBy;
  filterBy?: string | string[] | null;
  targetCount?: number | 'all' | null;
}

export type GamePhase = 1 | 2; // 1=探险 2=战斗

// ---- 统一实体定义（v3：启动端/装备统一模型） ----

/** 子实体规格：引用模板 + 可选字段覆写 + 词条预设 */
export interface DefaultChildSpec {
  /** 引用的实体模板 ID */
  defId: string;
  /** 按需覆写的字段，只存与模板的差异。未指定的字段使用模板默认值 */
  overrides?: Partial<EntityDef>;
  /** 附加固定词条 — 与模板 fixedAffixes 合并去重（不替换），用于子实体出厂带额外类别/属性标记 */
  fixedAffixes?: string[];
  /** 预装动态词条 — 创建子实体时自动作为 affix 子项挂载到 children 中 */
  preloadedDynamicAffixes?: string[];
}

export interface EntityDef {
  // ---- 共享字段（所有实体都有） ----
  // 分类由 fixedAffixes 推导（follower/weapon_type/armor_type/accessory_type 等 entity_class 分类下的词条）
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
  /** 创建该实体时自动生成的子实体列表。字符串 = 纯模板引用; { defId, overrides?, fixedAffixes?, preloadedDynamicAffixes? } = 带覆写与词条预设 */
  defaultChildren?: (string | DefaultChildSpec)[];
  /** 模板级预装动态词条 — 创建实例时自动挂载到 children（占用 dynamicAffixSlots） */
  preloadedDynamicAffixes?: string[];

  // ---- 启动端字段（fixedAffixes 含 'starter' 时有效，否则为 0） ----
  /** 启动端: 基础HP; 装备: 始终为 0 */
  hp: number;
  maxStamina: number;
  staminaRegen: number;   // 耐力恢复/秒
  hpRegen: number;        // 生命恢复/秒
  maxLoad: number;

  // ---- 可触发动作字段（isActive=true 时有效） ----
  /** 实体是否拥有可触发动作 */
  isActive: boolean;
  staminaCost: number;
  /** 触发间隔（毫秒），isActive=true 时有效，否则为 0 */
  actionTime: number;
  /** isActive=true 时: 每次触发伤害（可为负值=恢复HP）; isActive=false 时: 全局伤害加成（加至所有武器） */
  damage: number;
  /** @deprecated */
  targetType: string | null;
  /** @deprecated 映射 sortBy */
  targetOrder: string | null;
  /** @deprecated 映射站位k */
  priorityTarget: number | null;
  targetFaction: TargetFaction | null;
  /** 目标数量，默认 1；all/-1 = 全部 */
  targetCount?: number | 'all' | null;
  targetCondition?: TargetCondition;

  // ---- 被动加成（对最外层启动端实体生效） ----
  /** 被动加成: 耐力恢复/秒 */
  staminaRegenerationBonus: number;
  /** 被动加成: 耐力 */
  staminaBonus: number;
  /** 被动加成: 生命恢复/秒 */
  hpRegenerationBonus: number;
  /** 被动加成: 生命 */
  hpBonus: number;
}

// ---- 命中效果 ----

/** 命中效果定义 — 武器命中后触发的额外效果 */
export interface OnHitEffect {
  type: string;                    // 效果类型ID（如 'life_steal', 'stamina_drain'）
  params: Record<string, number>;  // 可扩展参数（如 { percent: 10 } 或 { amount: 5 }）
}

// ---- 词条 ----

export interface AffixDef {
  id: string;
  name: string;
  category: string;    // 动态 string，由 categories 表驱动
  value: number;
  costValue: number;
  slotCost: number;
  repeatable: boolean;
  prerequisite: string[];
  poolPrerequisite: string[];
  effect: string;
  /** 命中效果列表 */
  onHitEffects?: OnHitEffect[];

  // ---- 被动加成（与 EntityDef 对齐，挂载到启动端子树上时生效） ----
  /** 被动加成: 耐力恢复/秒 */
  staminaRegenerationBonus: number;
  /** 被动加成: 耐力 */
  staminaBonus: number;
  /** 被动加成: 生命恢复/秒 */
  hpRegenerationBonus: number;
  /** 被动加成: 生命 */
  hpBonus: number;
  /** 全局伤害加成（加至所有武器），独立于 isActive */
  damageBonus: number;
  /** targeting_modifier 分类词条的专属效果（v7 扩展）— 可覆写所有 targeting 字段 */
  targetingModifier?: TargetingModifier;
  /** 是否有被动加成（v7 新增）。
   *  false → 引擎跳过被动累加，避免逐字段检查零值，提升性能。
   *  由 admin 表单的「被动加成」主开关控制。 */
  hasPassiveBonuses?: boolean;
}

// ---- 物品实例（带实例 ID） ----

export interface ItemInstance {
  instanceId: string;
  defId: string;
  type: 'entity' | 'affix';
  /** 嵌套子项（实体 + 词条），递归支持多层嵌套 */
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
  round: number;
  phase: GamePhase;
  warehouse: ItemInstance[];
  deploySlots: DeploySlot[];
  itemPool: string[];
  seed: number;
  currentEvents: string[];
}

// ---- 战斗（v3：启动端+武器独立触发模型） ----

export interface CombatUnitSnapshot {
  // 唯一实例 ID
  instanceId: string;
  // 启动端自身
  entityId: string;
  entityName: string;
  totalHp: number;
  currentHp: number;
  totalStaminaRegen: number;       // 基础耐力恢复 + 所有 staminaRegenerationBonus 之和
  maxStamina: number;               // 基础耐力 + 所有 staminaBonus 之和
  currentStamina: number;
  staminaRegen: number;             // 纯自身基础值（不含加成）
  totalHpRegeneration: number;      // 基础生命恢复 + 所有 hpRegenerationBonus 之和
  currentLoad: number;
  maxLoad: number;
  isOverloaded: boolean;

  // 主动武器列表（每件独立在时间线上触发）
  activeWeapons: {
    name: string;
    actionTime: number;     // 绝对毫秒，固定值
    damage: number;          // 武器自身伤害 + isActive=false 实体 damage 加成
    staminaCost: number;
    targetType: string;      // '近战' | '远程'
    targetOrder: string;     // '从上往下' | '从下往上'
    priorityTarget: number | null; // 1|2|3|null
    targetFaction: string;   // '友方' | '敌人' | '所有'
  }[];
}

export interface CombatEvent {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  /** 伤害值（正=伤害，负=治疗）；与客户端引擎一致 */
  damage: number;
  targetHpAfter: number;
  targetMaxHp: number;
  effects: string[];
  targetingLabel?: string;
  /** @deprecated 旧多伤种字段，勿再写入 */
  physicalDamage?: number;
  fireDamage?: number;
  poisonDamage?: number;
  totalDamage?: number;
  actorHpAfter?: number;
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
