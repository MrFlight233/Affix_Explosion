// ============================================================
// 游戏数据 — 实体和词条定义
// v5: 数据统一从服务端 API 加载，废弃客户端硬编码 fallback
// ============================================================

export type {
  OnHitEffect,
  OnHitApplyTo,
  OnHitStat,
  OnHitOp,
} from '@shared/hitEffectUtil';
import type { OnHitEffect } from '@shared/hitEffectUtil';
import { normalizeOnHitEffects } from './hitEffectUtil';

/** 条件 Targeting 配置（v8：多选过滤 + 统一排序 + 目标数量） */
export interface TargetCondition {
  sortBy?: string | null;
  filterBy?: string | string[] | null;
  targetCount?: number | 'all' | null;
  /** @deprecated */
  fallback?: string;
}

/** Targeting 覆写（v8+：阵营只走 filterBy；targetFaction 仅读档兼容） */
export interface TargetingModifier {
  /** @deprecated 读档并入 filterBy */
  targetFaction?: string | null;
  /** @deprecated */
  targetOrder?: string | null;
  /** @deprecated */
  priorityTarget?: number | null;
  sortBy?: string | null;
  filterBy?: string | string[] | null;
  targetCount?: number | 'all' | null;
}

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
  /** 模板级预装动态词条 — 创建实例时自动挂载到 children（按各词条 slotCost 占用 dynamicAffixSlots） */
  preloadedDynamicAffixes?: string[];

  // ---- 启动端字段（fixedAffixes 含 'starter' 时有效，否则为 0） ----
  /** 启动端: 基础HP; 装备: 始终为 0 */
  hp: number;
  maxStamina: number; staminaRegen: number; hpRegen: number; maxLoad: number;

  // ---- 可触发动作字段（isActive=true 时有效） ----
  /** 实体是否拥有可触发动作 */
  isActive: boolean;
  staminaCost: number;
  /** 触发间隔（毫秒），isActive=true 时有效，否则为 0 */
  actionTime: number;
  /** @deprecated 读档迁移进 onHitEffects；新配置勿依赖 */
  damage: number;
  /** 命中效果列表（数值变化管道；与词条字段同名同结构） */
  onHitEffects?: OnHitEffect[];
  targetType: string | null; // @deprecated 忽略
  targetOrder: string | null; // @deprecated 映射 sortBy
  priorityTarget: number | null; // @deprecated 映射站位k
  /** @deprecated 读档并入 filterBy；新配置勿写 */
  targetFaction: string | null;
  /** 目标数量；默认 1；'all' 或 -1 = 全部 */
  targetCount?: number | 'all' | null;
  /** 条件 Targeting（sortBy / filterBy[] / 可选 targetCount） */
  targetCondition?: TargetCondition;

  // ---- 被动加成（对最外层启动端实体生效） ----
  /** 是否有被动加成。false → 引擎跳过该实体被动累加。 */
  hasPassiveBonuses?: boolean;
  /** 被动加成: 耐力恢复/秒 */
  staminaRegenerationBonus: number;
  /** 被动加成: 耐力 */
  staminaBonus: number;
  /** 被动加成: 生命恢复/秒 */
  hpRegenerationBonus: number;
  /** 被动加成: 生命 */
  hpBonus: number;
  /** 被动加成: 负重上限（聚合到最近启动端 maxLoad） */
  loadBonus: number;
}

export interface AffixDef {
  id: string; name: string; category: string;
  costValue: number; slotCost: number;
  repeatable: boolean; prerequisite: string[]; poolPrerequisite: string[];
  effect: string;
  /** 命中效果列表（与实体同结构） */
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
  /** 被动加成: 负重上限（聚合到最近启动端 maxLoad） */
  loadBonus: number;
  /** targeting_modifier 分类词条的专属效果（v7 扩展）— 可覆写所有 targeting 字段 */
  targetingModifier?: TargetingModifier;
  /** 是否有被动加成（v7 新增）。false → 引擎跳过被动累加，提升性能。 */
  hasPassiveBonuses?: boolean;
}

export interface CategoryDef {
  id: string;           // 代码标识，如 'attribute', 'entity_class'
  name: string;         // 显示名，如 '属性', '实体分类'
  sortOrder: number;
  isEntityClass: boolean;
  /** 是否在正式局商店词条分类筛选 Chip 中展示；缺省视为 true。不影响全物品池/模拟战/管理端 */
  showInFilter: boolean;
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

// ---- 分类数据（从服务端 API 加载，reloadData 填充） ----
export const CATEGORIES: CategoryDef[] = [];

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
  CATEGORIES.length = 0;
  if (data.categories) CATEGORIES.push(...data.categories);
  _dataLoaded = true;
}

// ---- 辅助函数（v3：新类型守卫） ----
export function getEntityDef(id: string): EntityDef | undefined {
  return ENTITY_DEFS.find(e => e.id === id);
}
export function getAffixDef(id: string): AffixDef | undefined {
  return AFFIX_DEFS.find(a => a.id === id);
}

/** 根据分类 ID 获取显示名称 */
export function getCategoryName(categoryId: string): string {
  const c = CATEGORIES.find(c => c.id === categoryId);
  return c ? c.name : categoryId;
}

/** 获取用于词条筛选的分类列表（全部分类；管理端/全物品池/模拟战） */
export function getAffixFilterCategories(): CategoryDef[] {
  return [...CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 正式局商店词条筛选用分类（仅 showInFilter 不为 false） */
export function getShopAffixFilterCategories(): CategoryDef[] {
  return [...CATEGORIES]
    .filter(c => c.showInFilter !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 获取实体分类标记的分类 ID 集合（isEntityClass=true） */
export function getEntityClassCategoryIds(): Set<string> {
  return new Set(CATEGORIES.filter(c => c.isEntityClass).map(c => c.id));
}

/**
 * 重新加载实体和词条数据（管理员修改后调用）。
 * 注意：ENTITY_DEFS 和 AFFIX_DEFS 是 const 引用，但内容可变。
 */
export function reloadData(entities: EntityDef[], affixes: AffixDef[], categories?: CategoryDef[]): void {
  ENTITY_DEFS.length = 0;
  ENTITY_DEFS.push(...entities.map(e => ({
    ...e,
    onHitEffects: normalizeOnHitEffects(e.onHitEffects || []),
  })));
  AFFIX_DEFS.length = 0;
  AFFIX_DEFS.push(...affixes.map(a => ({
    ...a,
    onHitEffects: normalizeOnHitEffects(a.onHitEffects || []),
  })));
  if (categories) {
    CATEGORIES.length = 0;
    CATEGORIES.push(...categories);
  }
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

/** 本体价值：模板字段（实体 value / 词条 abs(costValue)） */
export function getItemBaseValue(item: ItemInstance): number {
  if (item.type === 'affix') {
    const ad = getAffixDef(item.defId);
    return ad ? Math.abs(ad.costValue) : 0;
  }
  const ed = getEntityDef(item.defId);
  return ed?.value ?? 0;
}

/** 实例总价值：本体 + 固定词条 + children 递归（买卖/标价/卡片） */
export function getItemTradeValue(item: ItemInstance): number {
  if (item.type === 'affix') {
    return getItemBaseValue(item);
  }
  const def = getEntityDef(item.defId);
  if (!def) return 0;
  let total = def.value;
  const fixedIds = (item.overrides?.fixedAffixes ?? def.fixedAffixes) || [];
  for (const fa of fixedIds) {
    const ad = getAffixDef(fa);
    if (ad) total += Math.abs(ad.costValue);
  }
  for (const c of item.children || []) {
    total += getItemTradeValue(c);
  }
  return total;
}

/** 词条模板交付价（无子树 = 本体） */
export function getAffixPackageTradeValue(def: AffixDef): number {
  return Math.abs(def.costValue);
}

/**
 * 实体模板交付总价值：对齐 createItem 默认结构
 *（本体 + 固定词条 + 预装动态词条 + defaultChildren，含 spec 的 fixed/preload）
 */
export function getDefPackageTradeValue(def: EntityDef): number {
  return packageEntityValue(def, def.fixedAffixes || [], def.preloadedDynamicAffixes || []);
}

function packageEntityValue(
  def: EntityDef,
  fixedAffixes: string[],
  preloadedDynamicAffixes: string[],
  valueOverride?: number,
): number {
  let total = valueOverride !== undefined ? valueOverride : def.value;
  for (const fa of fixedAffixes) {
    const ad = getAffixDef(fa);
    if (ad) total += Math.abs(ad.costValue);
  }
  for (const aid of preloadedDynamicAffixes) {
    const ad = getAffixDef(aid);
    if (ad) total += Math.abs(ad.costValue);
  }
  for (const spec of def.defaultChildren || []) {
    const cid = typeof spec === 'string' ? spec : spec.defId;
    const childDef = getEntityDef(cid);
    if (!childDef) continue;
    let childFixed = childDef.fixedAffixes || [];
    let childPreload = childDef.preloadedDynamicAffixes || [];
    let childValueOverride: number | undefined;
    if (typeof spec !== 'string') {
      if (spec.fixedAffixes && spec.fixedAffixes.length > 0) {
        childFixed = [...new Set([...childFixed, ...spec.fixedAffixes])];
      }
      if (spec.preloadedDynamicAffixes && spec.preloadedDynamicAffixes.length > 0) {
        childPreload = [...(childDef.preloadedDynamicAffixes || []), ...spec.preloadedDynamicAffixes];
      }
      if (spec.overrides?.value !== undefined) childValueOverride = spec.overrides.value;
    }
    total += packageEntityValue(childDef, childFixed, childPreload, childValueOverride);
  }
  return total;
}

/**
 * 启动端当前负重 / 有效上限（与引擎 collectFromChildren 对齐）。
 * extraChildren：DeploySlot.children 尚未并入 entity 时传入。
 */
export function computeStarterLoad(
  starter: ItemInstance,
  extraChildren?: ItemInstance[],
): { current: number; max: number } {
  const def = getEntityDef(starter.defId);
  if (!def) return { current: 0, max: 0 };

  const walk = (children: ItemInstance[]): { load: number; bonus: number } => {
    let load = 0;
    let bonus = 0;
    for (const child of children) {
      if (child.type === 'entity') {
        const cdef = getEntityDef(child.defId);
        if (!cdef) continue;
        load += Number(getEffectiveValue(child, 'weight') ?? 0);
        const childHasPB = getEffectiveValue(child, 'hasPassiveBonuses') ?? cdef.hasPassiveBonuses;
        if (childHasPB) {
          bonus += Number(getEffectiveValue(child, 'loadBonus') ?? 0);
        }
        if (child.children?.length) {
          const nested = walk(child.children);
          load += nested.load;
          bonus += nested.bonus;
        }
      } else if (child.type === 'affix') {
        const adef = getAffixDef(child.defId);
        if (adef?.hasPassiveBonuses) {
          bonus += adef.loadBonus ?? 0;
        }
      }
    }
    return { load, bonus };
  };

  const merged = [...(starter.children || []), ...(extraChildren || [])];
  const collected = walk(merged);
  let loadBonus = collected.bonus;
  if (def.hasPassiveBonuses) {
    loadBonus += def.loadBonus ?? 0;
  }
  return {
    current: collected.load,
    max: def.maxLoad + loadBonus,
  };
}

/** 从固定词条推导实体分类（动态：根据 isEntityClass 分类下的词条，返回所有匹配的分类名） */
export function getEntityCategory(def: EntityDef): string[] {
  const entityClassCatIds = getEntityClassCategoryIds();
  const names: string[] = [];
  const seen = new Set<string>();
  for (const aid of def.fixedAffixes) {
    const a = getAffixDef(aid);
    if (a && entityClassCatIds.has(a.category) && !seen.has(a.name)) {
      seen.add(a.name);
      names.push(a.name);
    }
  }
  return names.length > 0 ? names : ['未知'];
}

/** 获取实体分类筛选选项列表（动态：根据实际存在的实体分类标记词条） */
export function getEntityCategoryFilters(): string[] {
  const entityClassCatIds = getEntityClassCategoryIds();
  const names = AFFIX_DEFS
    .filter(a => entityClassCatIds.has(a.category))
    .map(a => a.name);
  return ['all', ...names];
}

/** 判断是否为启动端（fixedAffixes 包含 'starter'） */
export function isStarter(def: EntityDef): boolean {
  return def.fixedAffixes.includes('starter');
}

/**
 * 开局默认启动端 ID。
 * 优先 human（当前模板），否则取任意含 starter 的实体；库空时回退 human。
 */
export function getDefaultStarterId(): string {
  const human = getEntityDef('human');
  if (human && isStarter(human)) return 'human';
  const found = ENTITY_DEFS.find(e => isStarter(e));
  if (found) return found.id;
  return 'human';
}

/** 判断是否为可触发动作实体（非启动端且 isActive=true） */
export function isActiveEquipment(def: EntityDef): boolean {
  return !isStarter(def) && def.isActive;
}

/** 判断实体是否有实体槽位（可嵌套子实体） */
export function hasEntitySlots(def: EntityDef): boolean {
  return def.entitySlots > 0;
}

/** 获取实体有效槽位数 */
export function getEffectiveEntitySlots(def: EntityDef): number {
  return def.entitySlots;
}

/** 第一层槽位上限 = floor((round+1)/2) */
export function getFirstLayerSlots(round: number): number {
  return Math.floor((round + 1) / 2);
}

/** 计算某父实体的已被占用的槽位（只看直属实体类子项；slotCost=0 不占） */
export function countUsedSlots(parent: ItemInstance): number {
  if (!parent.children) return 0;
  return parent.children
    .filter(c => c.type === 'entity')
    .reduce((sum, c) => {
      const d = getEntityDef(c.defId);
      return sum + (d ? d.slotCost : 0);
    }, 0);
}

/** 计算某父实体动态词条已占用槽位（slotCost 之和；slotCost=0 不占） */
export function countUsedAffixSlots(parent: ItemInstance): number {
  if (!parent.children) return 0;
  return parent.children
    .filter(c => c.type === 'affix')
    .reduce((sum, c) => {
      const d = getAffixDef(c.defId);
      return sum + (d ? d.slotCost : 0);
    }, 0);
}

/** 词条显示名（缺模板时回退 id） */
function affixDisplayName(defId: string): string {
  return getAffixDef(defId)?.name || defId;
}

/**
 * 实体「已有词条」ID 集合：固定（含 overrides）+ 动态子项（children 中 affix）。
 * extraChildren：额外并入的子项（如 DeploySlot.children 尚未合并进 entity 时）。
 */
export function getEntityOwnedAffixIds(
  entity: ItemInstance,
  extraChildren?: ItemInstance[],
): Set<string> {
  const ids = new Set<string>();
  const edef = getEntityDef(entity.defId);
  const fixed = entity.overrides?.fixedAffixes ?? edef?.fixedAffixes ?? [];
  for (const id of fixed) ids.add(id);
  for (const c of entity.children || []) {
    if (c.type === 'affix') ids.add(c.defId);
  }
  if (extraChildren) {
    for (const c of extraChildren) {
      if (c.type === 'affix') ids.add(c.defId);
    }
  }
  return ids;
}

/**
 * 是否可将词条挂到实体上（校验 AffixDef.prerequisite）。
 * @returns 错误文案；null 表示通过
 */
export function canMountAffix(
  parent: ItemInstance,
  affixDefId: string,
  extraChildren?: ItemInstance[],
): string | null {
  const adef = getAffixDef(affixDefId);
  if (!adef) return '未知词条';
  const prereq = adef.prerequisite || [];
  if (prereq.length === 0) return null;
  const owned = getEntityOwnedAffixIds(parent, extraChildren);
  const missing = prereq.filter(p => !owned.has(p));
  if (missing.length === 0) return null;
  return `需要前置词条：${missing.map(affixDisplayName).join('、')}`;
}

/**
 * 是否可从实体卸下/迁走某动态词条实例。
 * 卸下后若仍有其它动态词条前置不满足（固定词条仍可顶替），则拒绝。
 * @returns 错误文案；null 表示通过
 */
export function canRemoveAffix(parent: ItemInstance, affixInstanceId: string): string | null {
  const children = parent.children || [];
  const target = children.find(c => c.instanceId === affixInstanceId && c.type === 'affix');
  if (!target) return null; // 非本父下动态词条（或固定词条）— 不由此函数拦截

  const ownedAfter = new Set<string>();
  const edef = getEntityDef(parent.defId);
  const fixed = parent.overrides?.fixedAffixes ?? edef?.fixedAffixes ?? [];
  for (const id of fixed) ownedAfter.add(id);
  for (const c of children) {
    if (c.instanceId === affixInstanceId || c.type !== 'affix') continue;
    ownedAfter.add(c.defId);
  }

  const dependents: string[] = [];
  for (const c of children) {
    if (c.instanceId === affixInstanceId || c.type !== 'affix') continue;
    const d = getAffixDef(c.defId);
    const missing = (d?.prerequisite || []).filter(p => !ownedAfter.has(p));
    if (missing.length > 0) dependents.push(affixDisplayName(c.defId));
  }
  if (dependents.length === 0) return null;
  return `不可移除「${affixDisplayName(target.defId)}」：${dependents.join('、')} 依赖此词条`;
}

/** 在 ItemInstance 树中查找 child 的直接父实体；找不到返回 null */
export function findParentInTree(root: ItemInstance, childId: string): ItemInstance | null {
  for (const c of root.children || []) {
    if (c.instanceId === childId) return root;
    const p = findParentInTree(c, childId);
    if (p) return p;
  }
  return null;
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
