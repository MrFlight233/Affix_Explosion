// ============================================================
// 游戏数据 — 实体和词条定义
// v5: 数据统一从服务端 API 加载，废弃客户端硬编码 fallback
// ============================================================

/** 子实体规格（Template/Instance 分离）：引用模板 + 可选字段覆写 + 词条预设 */
export interface DefaultChildSpec {
  defId: string;
  overrides?: Partial<EntityDef>;
  /** 附加固定词条 — 与模板 fixedAffixes 合并去重（不替换） */
  fixedAffixes?: string[];
  /** 预装动态词条 — 创建子实体时自动作为 affix 子项挂载 */
  preloadedDynamicAffixes?: string[];
}

export interface EntityDef {
  // ---- 共享字段（所有实体都有） ----
  // 分类由 fixedAffixes 推导：follower→随从, weapon_type→武器, armor_type→防具, accessory_type→饰品, container1-4→容器
  id: string; name: string;
  slotCost: number; entitySlots: number;
  /** 装备: 重量（计入父启动端负重）; 启动端: 0 */
  weight: number;
  value: number; fixedAffixes: string[]; dynamicAffixSlots: number; poolPrerequisite: string[];
  /** 创建该实体时自动生成的子实体列表。字符串 = 纯模板引用; { defId, overrides?, fixedAffixes?, preloadedDynamicAffixes? } = 带覆写与词条预设 */
  defaultChildren?: (string | DefaultChildSpec)[];
  /** 模板级预装动态词条 — 创建实例时自动挂载到 children（占用 dynamicAffixSlots） */
  preloadedDynamicAffixes?: string[];

  // ---- 启动端字段（fixedAffixes 含 'starter' 时有效，否则为 0） ----
  /** 启动端: 基础HP; 装备: 始终为 0 */
  hp: number;
  maxStamina: number; staminaRegen: number; maxLoad: number;

  // ---- 主动装备字段（isActive=true 时有效） ----
  /** 启动端始终为 false */
  isActive: boolean;
  staminaCost: number;
  /** 主动装备: 绝对毫秒值; 启动端/被动装备: 0 */
  actionTime: number;
  /** 主动装备: 每次触发伤害（可为负值表示恢复HP）; 被动装备: 全局伤害加成（加至所有主动武器）; 启动端: 始终为 0 */
  damage: number;
  targetType: string | null; targetOrder: string | null; priorityTarget: number | null;
  targetFaction: string | null; // '友方'|'敌人'|'所有'

  // ---- 被动加成（对父实体生效） ----
  /** 被动加成: 回复/秒 */
  regenBonus: number;
  /** 分配给父实体的 HP 加成 */
  hpBonus: number;
}

export interface AffixDef {
  id: string; name: string; category: string;
  value: number; costValue: number; slotCost: number;
  repeatable: boolean; prerequisite: string[]; poolPrerequisite: string[];
  effect: string;
}

export interface ItemInstance {
  instanceId: string;
  defId: string;
  type: 'entity' | 'affix';
  /** 容器实体的嵌套子项（实体 + 词条），递归支持多层嵌套 */
  children?: ItemInstance[];
  /** 实例级字段覆写 — 覆盖 EntityDef 模板值。用于 defaultChildren 差异化创建 */
  overrides?: Partial<EntityDef>;
}

export interface DeploySlot {
  entity: ItemInstance;
  /** 启动端直属子项（装备/词条），容器实体内的嵌套子项在 entity.children 中 */
  children: ItemInstance[];
}

// ---- 实体数据（从服务端 API 加载，reloadData 填充） ----

export const ENTITY_DEFS: EntityDef[] = [];

// ---- 词条数据（从服务端 API 加载，reloadData 填充） ----
export const AFFIX_DEFS: AffixDef[] = [];

// ---- 数据加载状态 ----

let _dataLoaded = false;

/** 检查初始数据是否已从服务端加载 */
export function isDataLoaded(): boolean {
  return _dataLoaded;
}

/** 启动时从服务端 API 加载实体和词条数据 */
export async function loadInitialData(): Promise<void> {
  const resp = await fetch('/api/data/all');
  if (!resp.ok) throw new Error(`数据加载失败: HTTP ${resp.status}`);
  const data = await resp.json();
  ENTITY_DEFS.length = 0;
  ENTITY_DEFS.push(...data.entities);
  AFFIX_DEFS.length = 0;
  AFFIX_DEFS.push(...data.affixes);
  _dataLoaded = true;
}

// ---- 辅助函数（v3：新类型守卫） ----
export function getEntityDef(id: string): EntityDef | undefined {
  return ENTITY_DEFS.find(e => e.id === id);
}
export function getAffixDef(id: string): AffixDef | undefined {
  return AFFIX_DEFS.find(a => a.id === id);
}

/**
 * 重新加载实体和词条数据（管理员修改后调用）。
 * 注意：ENTITY_DEFS 和 AFFIX_DEFS 是 const 引用，但内容可变。
 */
export function reloadData(entities: EntityDef[], affixes: AffixDef[]): void {
  ENTITY_DEFS.length = 0;
  ENTITY_DEFS.push(...entities);
  AFFIX_DEFS.length = 0;
  AFFIX_DEFS.push(...affixes);
  _dataLoaded = true;
}

// ---- Template/Instance 辅助函数 ----

/** 解析 DefaultChildSpec → 模板 defId */
export function resolveDefaultChild(spec: string | DefaultChildSpec): string {
  return typeof spec === 'string' ? spec : spec.defId;
}

/** 从 DefaultChildSpec 提取覆写字段（字符串格式返回 undefined） */
export function getDefaultChildOverrides(spec: string | DefaultChildSpec): Partial<EntityDef> | undefined {
  return typeof spec === 'string' ? undefined : spec.overrides;
}

/**
 * 获取实体实例的有效值：优先从 ItemInstance.overrides 取值，fallback 到 EntityDef 模板。
 * 这是 Template/Instance 分离的核心函数。
 */
export function getEffectiveValue(item: ItemInstance, field: keyof EntityDef): any {
  if (item.overrides && item.overrides[field] !== undefined) {
    return item.overrides[field];
  }
  const def = getEntityDef(item.defId);
  return def ? def[field] : undefined;
}

/** 从固定词条推导实体分类（动态：根据实际存在的分类/容器词条） */
export function getEntityCategory(def: EntityDef): string {
  // 1. 分类词条（category === '类别'）——纯分类标记，取固定词条中第一个匹配的
  const classAffixes = AFFIX_DEFS.filter((a: AffixDef) => a.category === '类别');
  const classIdSet = new Set(classAffixes.map(a => a.id));
  for (const aid of def.fixedAffixes) {
    if (classIdSet.has(aid)) {
      const a = classAffixes.find(x => x.id === aid);
      return a ? a.name : aid;
    }
  }
  // 2. 容器类词条（category === '容器'）——功能+分类双重作用
  const containerIdSet = new Set(
    AFFIX_DEFS.filter((a: AffixDef) => a.category === '容器').map(a => a.id)
  );
  for (const aid of def.fixedAffixes) {
    if (containerIdSet.has(aid)) return '容器';
  }
  return '未知';
}

/** 获取实体分类筛选选项列表（动态：根据实际存在的分类/容器词条） */
export function getEntityCategoryFilters(): string[] {
  const classNames = AFFIX_DEFS.filter((a: AffixDef) => a.category === '类别').map(a => a.name);
  const hasContainer = AFFIX_DEFS.some((a: AffixDef) => a.category === '容器');
  return ['all', ...classNames, ...(hasContainer ? ['容器'] : [])];
}

/** 判断是否为启动端（fixedAffixes 包含 'starter'） */
export function isStarter(def: EntityDef): boolean {
  return def.fixedAffixes.includes('starter');
}

/** 判断是否为主动装备（非启动端且 isActive=true） */
export function isActiveEquipment(def: EntityDef): boolean {
  return !isStarter(def) && def.isActive;
}

/** 判断实体是否有实体槽位（可嵌套子实体） */
export function hasEntitySlots(def: EntityDef): boolean {
  return def.entitySlots > 0;
}

/** 获取容器词条等级（从实体定义+已挂词条中取最高级，覆写不叠加） */
export function getContainerLevel(def: EntityDef, item?: ItemInstance): number {
  let level = 0;
  for (const fa of def.fixedAffixes) {
    if (fa === 'container1') level = Math.max(level, 1);
    else if (fa === 'container2') level = Math.max(level, 2);
    else if (fa === 'container3') level = Math.max(level, 3);
    else if (fa === 'container4') level = Math.max(level, 4);
  }
  if (item?.children) {
    for (const c of item.children) {
      if (c.type === 'affix') {
        if (c.defId === 'container1') level = Math.max(level, 1);
        else if (c.defId === 'container2') level = Math.max(level, 2);
        else if (c.defId === 'container3') level = Math.max(level, 3);
        else if (c.defId === 'container4') level = Math.max(level, 4);
      }
    }
  }
  return level;
}

/** 获取实体有效槽位数（基础 + 容器词条等级） */
export function getEffectiveEntitySlots(def: EntityDef, item?: ItemInstance): number {
  return def.entitySlots + getContainerLevel(def, item);
}

/** 获取第一层实体槽位上限（等于当前回合数） */
export function getFirstLayerSlots(round: number): number {
  return round;
}

/** 计算某父实体的已被占用的槽位（只看直属实体类子项） */
export function countUsedSlots(parent: ItemInstance): number {
  if (!parent.children) return 0;
  return parent.children
    .filter(c => c.type === 'entity')
    .reduce((sum, c) => {
      const d = getEntityDef(c.defId);
      return sum + (d ? d.slotCost : 0);
    }, 0);
}

/** 在 ItemInstance 树中递归搜索 */
export function findInTree(root: ItemInstance, instanceId: string): ItemInstance | null {
  if (root.instanceId === instanceId) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findInTree(child, instanceId);
      if (found) return found;
    }
  }
  return null;
}

/** 从父的 children 中移除并返回 */
export function removeFromTreeChildren(parent: ItemInstance, instanceId: string): ItemInstance | null {
  if (!parent.children) return null;
  const idx = parent.children.findIndex(c => c.instanceId === instanceId);
  if (idx === -1) {
    // 深度搜索
    for (const child of parent.children) {
      const found = removeFromTreeChildren(child, instanceId);
      if (found) return found;
    }
    return null;
  }
  const [removed] = parent.children.splice(idx, 1);
  return removed;
}

// 简单 ID 生成
let _idCounter = Date.now();
export function genId(): string {
  return 'i_' + (++_idCounter).toString(36);
}
