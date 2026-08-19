// ============================================================
// 模板内存缓存 — 启动时全量加载，后续读取零 DB 查询
// Admin 写操作通过写穿透（write-through）保持缓存与 DB 一致
// ============================================================

import { getDB } from './connection';
import { normalizeOnHitEffects } from '@shared/hitEffectUtil';
import { resolvePassiveBonusConfig } from '@shared/passiveBonusUtil';
import {
  normalizeActiveChannel,
  normalizeEffectDef,
  normalizePassiveChannel,
  type EffectDef,
} from '@shared/effectDef';
import { resolveActiveBindings, resolvePassiveBindings } from '@shared/effectResolve';

function parseJsonField(val: string | null | undefined): any {
  if (val == null || val === '') return undefined;
  return JSON.parse(val);
}

function serializeJsonField(val: any): string {
  return JSON.stringify(val ?? []);
}

function attachChannelsAndResolvedEffects(def: Record<string, any>): Record<string, any> {
  const activeChannel = normalizeActiveChannel(def.activeChannel);
  const passiveChannel = normalizePassiveChannel(
    def.passiveChannel ?? {
      enabled: def.hasPassiveBonuses === true,
      effectBindings: [],
      targetCondition: def.passiveTargetCondition,
      targetCount: def.passiveTargetCount,
    },
  );

  const catalog = templateCache.getEffectMap();
  if (activeChannel.effectBindings.length > 0 && catalog.size > 0) {
    def.onHitEffects = resolveActiveBindings(activeChannel.effectBindings, catalog, def.name);
  } else {
    def.onHitEffects = normalizeOnHitEffects(def.onHitEffects ?? []);
  }

  if (passiveChannel.enabled && passiveChannel.effectBindings.length > 0 && catalog.size > 0) {
    def.passiveEffects = resolvePassiveBindings(passiveChannel.effectBindings, catalog, def.name);
    def.hasPassiveBonuses = true;
  } else if (passiveChannel.enabled) {
    const cfg = resolvePassiveBonusConfig({
      hasPassiveBonuses: true,
      passiveEffects: def.passiveEffects,
      passiveTargetCondition: passiveChannel.targetCondition ?? def.passiveTargetCondition,
      passiveTargetCount: passiveChannel.targetCount ?? def.passiveTargetCount,
      hpBonus: def.hpBonus,
      hpRegenerationBonus: def.hpRegenerationBonus,
      staminaBonus: def.staminaBonus,
      staminaRegenerationBonus: def.staminaRegenerationBonus,
      loadBonus: def.loadBonus,
    });
    def.passiveEffects = cfg.passiveEffects;
    def.hasPassiveBonuses = cfg.hasPassiveBonuses;
  } else {
    def.passiveEffects = [];
    def.hasPassiveBonuses = false;
  }

  def.activeChannel = activeChannel;
  def.passiveChannel = {
    ...passiveChannel,
    targetCondition: passiveChannel.targetCondition ?? def.passiveTargetCondition,
    targetCount: passiveChannel.targetCount ?? def.passiveTargetCount ?? 1,
  };
  def.passiveTargetCondition = def.passiveChannel.targetCondition;
  def.passiveTargetCount = def.passiveChannel.targetCount;
  def.hpBonus = 0;
  def.hpRegenerationBonus = 0;
  def.staminaBonus = 0;
  def.staminaRegenerationBonus = 0;
  def.loadBonus = 0;
  return def;
}

export function effectRowToDef(row: Record<string, any>): EffectDef {
  const def = normalizeEffectDef({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    allowActive: row.allow_active === 1,
    allowPassive: row.allow_passive === 1,
    kind: row.kind,
    stat: row.stat,
    op: row.op,
    defaultParams: parseJsonField(row.default_params) ?? {},
    defaultDurationMs: row.default_duration_ms ?? undefined,
    defaultTickIntervalMs: row.default_tick_interval_ms ?? undefined,
    defaultDisplayName: row.default_display_name ?? undefined,
    defaultApplyTo: parseJsonField(row.default_apply_to),
    paramSchema: parseJsonField(row.param_schema),
    category: row.category ?? undefined,
  });
  if (!def) throw new Error(`无效效果行: ${row.id}`);
  return def;
}

export function effectDefToRow(def: EffectDef | Record<string, any>): Record<string, any> {
  const n = normalizeEffectDef(def);
  if (!n) throw new Error('无效效果定义');
  return {
    id: n.id,
    name: n.name,
    description: n.description ?? '',
    allow_active: n.allowActive ? 1 : 0,
    allow_passive: n.allowPassive ? 1 : 0,
    kind: n.kind,
    stat: n.stat,
    op: n.op,
    default_params: JSON.stringify(n.defaultParams ?? {}),
    default_duration_ms: n.defaultDurationMs ?? null,
    default_tick_interval_ms: n.defaultTickIntervalMs ?? null,
    default_display_name: n.defaultDisplayName ?? null,
    default_apply_to: n.defaultApplyTo != null ? JSON.stringify(n.defaultApplyTo) : null,
    param_schema: n.paramSchema != null ? JSON.stringify(n.paramSchema) : null,
    category: n.category ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function entityRowToDef(row: Record<string, any>): Record<string, any> {
  return attachChannelsAndResolvedEffects({
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
    onHitEffects: parseJsonField(row.on_hit_effects) ?? [],
    targetType: row.target_type,
    targetOrder: row.target_order,
    priorityTarget: row.priority_target,
    targetFaction: row.target_faction,
    targetCount: row.target_count === -1 ? 'all' : (row.target_count ?? undefined),
    targetCondition: parseJsonField(row.target_condition),
    staminaRegenerationBonus: row.stamina_regeneration_bonus,
    staminaBonus: row.stamina_bonus,
    hpRegenerationBonus: row.hp_regeneration_bonus,
    hpBonus: row.hp_bonus,
    loadBonus: row.load_bonus ?? 0,
    hasPassiveBonuses: row.has_passive_bonuses === 1,
    passiveEffects: parseJsonField(row.passive_effects) ?? [],
    passiveTargetCondition: parseJsonField(row.passive_target_condition),
    passiveTargetCount: row.passive_target_count === -1 ? 'all' : (row.passive_target_count ?? undefined),
    activeChannel: parseJsonField(row.active_channel),
    passiveChannel: parseJsonField(row.passive_channel),
  });
}

export function entityDefToRow(def: Record<string, any>): Record<string, any> {
  const activeChannel = normalizeActiveChannel(
    def.activeChannel ?? {
      enabled: def.isActive,
      actionTime: def.actionTime,
      staminaCost: def.staminaCost,
      targetCondition: def.targetCondition,
      targetCount: def.targetCount,
      effectBindings: [],
    },
  );
  const passiveChannel = normalizePassiveChannel(
    def.passiveChannel ?? {
      enabled: def.hasPassiveBonuses === true,
      targetCondition: def.passiveTargetCondition,
      targetCount: def.passiveTargetCount,
      effectBindings: [],
    },
  );
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
    damage_bonus: 0,
    on_hit_effects: '[]',
    target_type: def.targetType ?? null,
    target_order: def.targetOrder ?? null,
    priority_target: def.priorityTarget ?? null,
    target_faction: def.targetFaction ?? null,
    target_count: def.targetCount === 'all' ? -1 : (def.targetCount ?? null),
    target_condition: def.targetCondition != null ? JSON.stringify(def.targetCondition) : null,
    stamina_regeneration_bonus: 0,
    stamina_bonus: 0,
    hp_regeneration_bonus: 0,
    hp_bonus: 0,
    load_bonus: 0,
    has_passive_bonuses: passiveChannel.enabled ? 1 : 0,
    passive_effects: '[]',
    passive_target_condition: passiveChannel.targetCondition != null
      ? JSON.stringify(passiveChannel.targetCondition)
      : null,
    passive_target_count: passiveChannel.targetCount === 'all' ? -1 : (passiveChannel.targetCount ?? null),
    active_channel: JSON.stringify(activeChannel),
    passive_channel: JSON.stringify(passiveChannel),
    updated_at: new Date().toISOString(),
  };
}

export function affixRowToDef(row: Record<string, any>): Record<string, any> {
  return attachChannelsAndResolvedEffects({
    id: row.id,
    name: row.name,
    category: row.category,
    costValue: row.cost_value,
    slotCost: row.slot_cost,
    repeatable: row.repeatable === 1,
    prerequisite: parseJsonField(row.prerequisite) ?? [],
    poolPrerequisite: parseJsonField(row.pool_prerequisite) ?? [],
    effect: row.effect,
    description: row.effect,
    onHitEffects: parseJsonField(row.on_hit_effects) ?? [],
    targetingModifier: parseJsonField(row.targeting_modifier),
    hasPassiveBonuses: row.has_passive_bonuses === 1,
    staminaRegenerationBonus: row.stamina_regeneration_bonus ?? 0,
    staminaBonus: row.stamina_bonus ?? 0,
    hpRegenerationBonus: row.hp_regeneration_bonus ?? 0,
    hpBonus: row.hp_bonus ?? 0,
    loadBonus: row.load_bonus ?? 0,
    passiveEffects: parseJsonField(row.passive_effects) ?? [],
    passiveTargetCondition: parseJsonField(row.passive_target_condition),
    passiveTargetCount: row.passive_target_count === -1 ? 'all' : (row.passive_target_count ?? undefined),
    activeChannel: parseJsonField(row.active_channel),
    passiveChannel: parseJsonField(row.passive_channel),
  });
}

export function affixDefToRow(def: Record<string, any>): Record<string, any> {
  const activeChannel = normalizeActiveChannel(def.activeChannel ?? { effectBindings: [] });
  const passiveChannel = normalizePassiveChannel(
    def.passiveChannel ?? {
      enabled: def.hasPassiveBonuses === true,
      targetCondition: def.passiveTargetCondition,
      targetCount: def.passiveTargetCount,
      effectBindings: [],
    },
  );
  const description = def.description ?? def.effect ?? '';
  return {
    id: def.id,
    name: def.name,
    category: def.category ?? '特殊',
    cost_value: def.costValue ?? 0,
    slot_cost: def.slotCost ?? 1,
    repeatable: def.repeatable ? 1 : 0,
    prerequisite: serializeJsonField(def.prerequisite),
    pool_prerequisite: serializeJsonField(def.poolPrerequisite),
    effect: description,
    on_hit_effects: '[]',
    damage_bonus: 0,
    targeting_modifier: def.targetingModifier != null ? JSON.stringify(def.targetingModifier) : null,
    has_passive_bonuses: passiveChannel.enabled ? 1 : 0,
    stamina_regeneration_bonus: 0,
    stamina_bonus: 0,
    hp_regeneration_bonus: 0,
    hp_bonus: 0,
    load_bonus: 0,
    passive_effects: '[]',
    passive_target_condition: passiveChannel.targetCondition != null
      ? JSON.stringify(passiveChannel.targetCondition)
      : null,
    passive_target_count: passiveChannel.targetCount === 'all' ? -1 : (passiveChannel.targetCount ?? null),
    active_channel: JSON.stringify(activeChannel),
    passive_channel: JSON.stringify(passiveChannel),
    updated_at: new Date().toISOString(),
  };
}

class TemplateCache {
  private _entities: Map<string, Record<string, any>> = new Map();
  private _affixes: Map<string, Record<string, any>> = new Map();
  private _categories: Map<string, Record<string, any>> = new Map();
  private _effects: Map<string, EffectDef> = new Map();
  private _version: number = 0;
  private _loaded = false;

  load(): void {
    const db = getDB();

    const allEffects = (() => {
      try {
        return db.prepare('SELECT * FROM effects').all() as any[];
      } catch {
        return [];
      }
    })();
    const allEntities = db.prepare('SELECT * FROM entities').all() as any[];
    const allAffixes = db.prepare('SELECT * FROM affixes').all() as any[];
    const allCategories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all() as any[];
    const verRow = db.prepare('SELECT version FROM data_version WHERE id = 1').get() as any;

    this._effects.clear();
    this._entities.clear();
    this._affixes.clear();
    this._categories.clear();

    for (const row of allEffects) {
      try {
        this._effects.set(row.id, effectRowToDef(row));
      } catch (e) {
        console.warn('[Cache] 跳过无效效果', row.id, e);
      }
    }
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
        showInFilter: row.show_in_filter !== 0,
      });
    }

    this._version = verRow?.version ?? 1;
    this._loaded = true;

    console.log(
      `[Cache] 模板缓存加载完成: ${this._entities.size} entities, ${this._affixes.size} affixes, ${this._effects.size} effects, ${this._categories.size} categories, version=${this._version}`,
    );
  }

  get isLoaded(): boolean { return this._loaded; }

  getEffectMap(): Map<string, EffectDef> {
    return this._effects;
  }

  getEffect(id: string): EffectDef | undefined {
    return this._effects.get(id);
  }

  getAllEffects(): EffectDef[] {
    return [...this._effects.values()];
  }

  setEffect(def: EffectDef | Record<string, any>): void {
    const n = normalizeEffectDef(def);
    if (n) this._effects.set(n.id, n);
  }

  deleteEffect(id: string): void {
    this._effects.delete(id);
  }

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

  getEntityClassCategoryIds(): Set<string> {
    const ids = new Set<string>();
    for (const c of this._categories.values()) {
      if (c.isEntityClass) ids.add(c.id as string);
    }
    return ids;
  }

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
