// ============================================================
// 模板内存缓存 — 启动时全量加载，后续读取零 DB 查询
// Admin 写操作通过写穿透（write-through）保持缓存与 DB 一致
// ============================================================

import { getDB } from './connection';

// ---- DB 行 ↔ 前端 EntityDef/AffixDef 转换 ----

function parseJsonField(val: string | null | undefined): any {
  if (val == null || val === '') return undefined;
  return JSON.parse(val);
}

function serializeJsonField(val: any): string {
  return JSON.stringify(val ?? []);
}

export function entityRowToDef(row: Record<string, any>): Record<string, any> {
  return {
    id: row.id,
    name: row.name,
    slotCost: row.slot_cost,
    entitySlots: row.entity_slots,
    weight: row.weight,
    value: row.value,
    fixedAffixes: parseJsonField(row.fixed_affixes) ?? [],
    dynamicAffixSlots: row.dynamic_affix_slots,
    poolPrerequisite: parseJsonField(row.pool_prerequisite) ?? [],
    defaultChildren: parseJsonField(row.default_children),
    preloadedDynamicAffixes: parseJsonField(row.preloaded_dynamic_affixes),
    hp: row.hp,
    maxStamina: row.max_stamina,
    staminaRegen: row.stamina_regen,
    hpRegen: row.hp_regen,
    maxLoad: row.max_load,
    isActive: row.is_active === 1,
    staminaCost: row.stamina_cost,
    actionTime: row.action_time,
    damage: row.damage,
    targetType: row.target_type,
    targetOrder: row.target_order,
    priorityTarget: row.priority_target,
    targetFaction: row.target_faction,
    staminaRegenerationBonus: row.stamina_regeneration_bonus,
    staminaBonus: row.stamina_bonus,
    hpRegenerationBonus: row.hp_regeneration_bonus,
    hpBonus: row.hp_bonus,
  };
}

export function entityDefToRow(def: Record<string, any>): Record<string, any> {
  return {
    id: def.id,
    name: def.name,
    slot_cost: def.slotCost ?? 1,
    entity_slots: def.entitySlots ?? 0,
    weight: def.weight ?? 0,
    value: def.value ?? 0,
    fixed_affixes: serializeJsonField(def.fixedAffixes),
    dynamic_affix_slots: def.dynamicAffixSlots ?? 0,
    pool_prerequisite: serializeJsonField(def.poolPrerequisite),
    default_children: def.defaultChildren != null ? JSON.stringify(def.defaultChildren) : null,
    preloaded_dynamic_affixes: def.preloadedDynamicAffixes != null ? JSON.stringify(def.preloadedDynamicAffixes) : null,
    hp: def.hp ?? 10,
    max_stamina: def.maxStamina ?? 50,
    stamina_regen: def.staminaRegen ?? 5,
    hp_regen: def.hpRegen ?? 0,
    max_load: def.maxLoad ?? 20,
    is_active: def.isActive ? 1 : 0,
    stamina_cost: def.staminaCost ?? 0,
    action_time: def.actionTime ?? 0,
    damage: def.damage ?? 0,
    target_type: def.targetType ?? null,
    target_order: def.targetOrder ?? null,
    priority_target: def.priorityTarget ?? null,
    target_faction: def.targetFaction ?? null,
    stamina_regeneration_bonus: def.staminaRegenerationBonus ?? 0,
    stamina_bonus: def.staminaBonus ?? 0,
    hp_regeneration_bonus: def.hpRegenerationBonus ?? 0,
    hp_bonus: def.hpBonus ?? 0,
    updated_at: new Date().toISOString(),
  };
}

export function affixRowToDef(row: Record<string, any>): Record<string, any> {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    value: row.value,
    costValue: row.cost_value,
    slotCost: row.slot_cost,
    repeatable: row.repeatable === 1,
    prerequisite: parseJsonField(row.prerequisite) ?? [],
    poolPrerequisite: parseJsonField(row.pool_prerequisite) ?? [],
    effect: row.effect,
  };
}

export function affixDefToRow(def: Record<string, any>): Record<string, any> {
  return {
    id: def.id,
    name: def.name,
    category: def.category ?? '特殊',
    value: def.value ?? 0,
    cost_value: def.costValue ?? 0,
    slot_cost: def.slotCost ?? 1,
    repeatable: def.repeatable ? 1 : 0,
    prerequisite: serializeJsonField(def.prerequisite),
    pool_prerequisite: serializeJsonField(def.poolPrerequisite),
    effect: def.effect ?? '',
    updated_at: new Date().toISOString(),
  };
}

// ============================================================
// TemplateCache
// ============================================================

class TemplateCache {
  private _entities: Map<string, Record<string, any>> = new Map();
  private _affixes: Map<string, Record<string, any>> = new Map();
  private _categories: Map<string, Record<string, any>> = new Map();
  private _version: number = 0;
  private _loaded = false;

  /** 启动时调用：从 DB 全量加载模板到内存 */
  load(): void {
    const db = getDB();

    const allEntities = db.prepare('SELECT * FROM entities').all() as any[];
    const allAffixes = db.prepare('SELECT * FROM affixes').all() as any[];
    const allCategories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all() as any[];
    const verRow = db.prepare('SELECT version FROM data_version WHERE id = 1').get() as any;

    this._entities.clear();
    this._affixes.clear();
    this._categories.clear();

    for (const row of allEntities) {
      this._entities.set(row.id, entityRowToDef(row));
    }
    for (const row of allAffixes) {
      this._affixes.set(row.id, affixRowToDef(row));
    }
    for (const row of allCategories) {
      this._categories.set(row.id, {
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        isEntityClass: row.is_entity_class === 1,
      });
    }

    this._version = verRow?.version ?? 1;
    this._loaded = true;

    console.log(`[Cache] 模板缓存加载完成: ${this._entities.size} entities, ${this._affixes.size} affixes, ${this._categories.size} categories, version=${this._version}`);
  }

  get isLoaded(): boolean { return this._loaded; }

  // ---- Entity 操作 ----

  getEntity(id: string): Record<string, any> | undefined {
    return this._entities.get(id);
  }

  getAllEntities(): Record<string, any>[] {
    return [...this._entities.values()];
  }

  setEntity(def: Record<string, any>): void {
    this._entities.set(def.id, def);
  }

  deleteEntity(id: string): void {
    this._entities.delete(id);
  }

  // ---- Affix 操作 ----

  getAffix(id: string): Record<string, any> | undefined {
    return this._affixes.get(id);
  }

  getAllAffixes(): Record<string, any>[] {
    return [...this._affixes.values()];
  }

  setAffix(def: Record<string, any>): void {
    this._affixes.set(def.id, def);
  }

  deleteAffix(id: string): void {
    this._affixes.delete(id);
  }

  // ---- Category 操作 ----

  getCategory(id: string): Record<string, any> | undefined {
    return this._categories.get(id);
  }

  getAllCategories(): Record<string, any>[] {
    return [...this._categories.values()];
  }

  setCategory(def: Record<string, any>): void {
    this._categories.set(def.id, def);
  }

  deleteCategory(id: string): void {
    this._categories.delete(id);
  }

  /** 返回所有 is_entity_class=1 的分类 ID 集合 */
  getEntityClassCategoryIds(): Set<string> {
    const ids = new Set<string>();
    for (const c of this._categories.values()) {
      if (c.isEntityClass) ids.add(c.id as string);
    }
    return ids;
  }

  // ---- Version ----

  get version(): number {
    return this._version;
  }

  bumpVersion(): void {
    this._version++;
    const db = getDB();
    db.prepare('UPDATE data_version SET version = ? WHERE id = 1').run(this._version);
  }

  reloadVersion(): void {
    const db = getDB();
    const verRow = db.prepare('SELECT version FROM data_version WHERE id = 1').get() as any;
    this._version = verRow?.version ?? 1;
  }
}

export const templateCache = new TemplateCache();
