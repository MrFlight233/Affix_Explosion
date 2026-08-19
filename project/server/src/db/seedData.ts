// ============================================================
// JSON 种子：发布（DB→文件）与空库导入（文件→DB）
// 目录：project/server/data/seed/
// ============================================================

import fs from 'fs';
import path from 'path';
import { getDB } from './connection';
import { templateCache, entityDefToRow, affixDefToRow, effectDefToRow } from './cache';
import { getSeedDir } from '../paths';

/** 种子相对 server 根 data/seed/（与 Git 跟踪路径一致；不随 cwd / DB_PATH 漂移） */
const SEED_DIR = getSeedDir(__dirname);

export interface SeedPublishResult {
  path: string;
  entities: number;
  affixes: number;
  effects: number;
  categories: number;
  version: number;
  exportedAt: string;
}

export interface SeedStatus {
  seedDir: string;
  exists: boolean;
  meta: SeedPublishResult | null;
}

function ensureSeedDir(): void {
  if (!fs.existsSync(SEED_DIR)) fs.mkdirSync(SEED_DIR, { recursive: true });
}

function sortById<T extends { id?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en'));
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 发布种子时通道为权威；清空旧内联列表，避免双轨回潮 */
function stripLegacyInlineEffects<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    onHitEffects: [],
    passiveEffects: [],
    damageBonus: 0,
    hpBonus: 0,
    hpRegenerationBonus: 0,
    staminaBonus: 0,
    staminaRegenerationBonus: 0,
    loadBonus: 0,
  };
}

function readJsonArray(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  throw new Error(`种子文件格式无效: ${file}`);
}

/** 将当前模板缓存写出为 Git 跟踪的种子 JSON */
export function publishSeed(): SeedPublishResult {
  if (!templateCache.isLoaded) {
    throw new Error('模板缓存未加载，无法发布种子');
  }

  ensureSeedDir();

  const entities = sortById(templateCache.getAllEntities()).map(stripLegacyInlineEffects);
  const affixes = sortById(templateCache.getAllAffixes()).map(stripLegacyInlineEffects);
  const effects = sortById(templateCache.getAllEffects());
  const categories = sortById(templateCache.getAllCategories());
  const exportedAt = new Date().toISOString();
  const version = templateCache.version;

  writeJson(path.join(SEED_DIR, 'entities.json'), entities);
  writeJson(path.join(SEED_DIR, 'affixes.json'), affixes);
  writeJson(path.join(SEED_DIR, 'effects.json'), effects);
  writeJson(path.join(SEED_DIR, 'categories.json'), categories);

  const meta: SeedPublishResult = {
    path: SEED_DIR,
    entities: entities.length,
    affixes: affixes.length,
    effects: effects.length,
    categories: categories.length,
    version,
    exportedAt,
  };
  writeJson(path.join(SEED_DIR, 'meta.json'), meta);

  console.log(
    `[Seed] 已发布种子: ${meta.entities} entities, ${meta.affixes} affixes, ${meta.effects} effects, ${meta.categories} categories → ${SEED_DIR}`
  );
  return meta;
}

export function getSeedStatus(): SeedStatus {
  const metaPath = path.join(SEED_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return { seedDir: SEED_DIR, exists: false, meta: null };
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SeedPublishResult;
    return { seedDir: SEED_DIR, exists: true, meta };
  } catch {
    return { seedDir: SEED_DIR, exists: true, meta: null };
  }
}

/**
 * 空库时从种子导入模板。
 * 条件：entities 与 affixes 均为 0 条；已有任一类模板则跳过（保护本地改动）。
 */
export function importSeedIfEmpty(): void {
  const db = getDB();
  const entityCount = (db.prepare('SELECT COUNT(*) AS c FROM entities').get() as { c: number }).c;
  const affixCount = (db.prepare('SELECT COUNT(*) AS c FROM affixes').get() as { c: number }).c;

  if (entityCount > 0 || affixCount > 0) {
    console.log(`[Seed] 本地已有模板（entities=${entityCount}, affixes=${affixCount}），跳过种子导入`);
    return;
  }

  const entitiesPath = path.join(SEED_DIR, 'entities.json');
  const affixesPath = path.join(SEED_DIR, 'affixes.json');
  const effectsPath = path.join(SEED_DIR, 'effects.json');
  const categoriesPath = path.join(SEED_DIR, 'categories.json');

  if (!fs.existsSync(entitiesPath) && !fs.existsSync(affixesPath) && !fs.existsSync(categoriesPath)) {
    console.log(`[Seed] 未找到种子目录 ${SEED_DIR}，跳过导入`);
    return;
  }

  let entities: any[];
  let affixes: any[];
  let effects: any[];
  let categories: any[];
  try {
    entities = readJsonArray(entitiesPath);
    affixes = readJsonArray(affixesPath);
    effects = fs.existsSync(effectsPath) ? readJsonArray(effectsPath) : [];
    categories = readJsonArray(categoriesPath);
  } catch (e) {
    console.error('[Seed] 读取种子失败:', (e as Error).message);
    return;
  }

  if (entities.length === 0 && affixes.length === 0 && categories.length === 0) {
    console.log('[Seed] 种子文件为空，跳过导入');
    return;
  }

  const insertCategory = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, sort_order, is_entity_class, show_in_filter, updated_at)
    VALUES (@id, @name, @sort_order, @is_entity_class, @show_in_filter, @updated_at)
  `);

  const insertEffect = db.prepare(`
    INSERT OR REPLACE INTO effects (
      id, name, description, allow_active, allow_passive, kind, stat, op,
      default_params, default_duration_ms, default_tick_interval_ms,
      default_display_name, default_apply_to, param_schema, category, updated_at
    ) VALUES (
      @id, @name, @description, @allow_active, @allow_passive, @kind, @stat, @op,
      @default_params, @default_duration_ms, @default_tick_interval_ms,
      @default_display_name, @default_apply_to, @param_schema, @category, @updated_at
    )
  `);

  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (
      id, name, slot_cost, entity_slots, weight, value, fixed_affixes, dynamic_affix_slots,
      pool_prerequisite, default_children, preloaded_dynamic_affixes, hp, max_stamina,
      stamina_regen, hp_regen, max_load, is_active, stamina_cost, action_time, damage, damage_bonus,
      on_hit_effects, target_type, target_order, priority_target, target_faction, target_count,
      target_condition, stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus,
      hp_bonus, load_bonus, has_passive_bonuses,
      passive_effects, passive_target_condition, passive_target_count,
      active_channel, passive_channel, updated_at
    ) VALUES (
      @id, @name, @slot_cost, @entity_slots, @weight, @value, @fixed_affixes, @dynamic_affix_slots,
      @pool_prerequisite, @default_children, @preloaded_dynamic_affixes, @hp, @max_stamina,
      @stamina_regen, @hp_regen, @max_load, @is_active, @stamina_cost, @action_time, @damage, @damage_bonus,
      @on_hit_effects, @target_type, @target_order, @priority_target, @target_faction, @target_count,
      @target_condition, @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus,
      @hp_bonus, @load_bonus, @has_passive_bonuses,
      @passive_effects, @passive_target_condition, @passive_target_count,
      @active_channel, @passive_channel, @updated_at
    )
  `);

  const insertAffix = db.prepare(`
    INSERT OR REPLACE INTO affixes (
      id, name, category, cost_value, slot_cost, repeatable, prerequisite, pool_prerequisite,
      effect, on_hit_effects, damage_bonus, targeting_modifier, has_passive_bonuses,
      stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus, hp_bonus, load_bonus,
      passive_effects, passive_target_condition, passive_target_count,
      active_channel, passive_channel, updated_at
    ) VALUES (
      @id, @name, @category, @cost_value, @slot_cost, @repeatable, @prerequisite, @pool_prerequisite,
      @effect, @on_hit_effects, @damage_bonus, @targeting_modifier, @has_passive_bonuses,
      @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus, @hp_bonus, @load_bonus,
      @passive_effects, @passive_target_condition, @passive_target_count,
      @active_channel, @passive_channel, @updated_at
    )
  `);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const c of categories) {
      if (!c?.id || !c?.name) continue;
      insertCategory.run({
        id: c.id,
        name: c.name,
        sort_order: c.sortOrder ?? 0,
        is_entity_class: c.isEntityClass ? 1 : 0,
        show_in_filter: c.showInFilter === false ? 0 : 1,
        updated_at: now,
      });
    }
    for (const ef of effects) {
      if (!ef?.id || !ef?.name) continue;
      insertEffect.run(effectDefToRow(ef));
    }
    const channelNeedsPassiveBackfill = (item: any): boolean => {
      const binds = item?.passiveChannel?.effectBindings;
      const hasBinds = Array.isArray(binds) && binds.length > 0;
      const pe = item?.passiveEffects;
      return !hasBinds && (item?.hasPassiveBonuses || (Array.isArray(pe) && pe.length > 0));
    };
    const channelNeedsActiveBackfill = (item: any): boolean => {
      const binds = item?.activeChannel?.effectBindings;
      const hasBinds = Array.isArray(binds) && binds.length > 0;
      const oh = item?.onHitEffects;
      return !hasBinds && Array.isArray(oh) && oh.length > 0;
    };

    for (const e of entities) {
      if (!e?.id || !e?.name) continue;
      const row = entityDefToRow(e);
      // 通道空绑定但仍有旧列表时，保留旧字段并清空通道，供随后 v11 补迁
      if (channelNeedsActiveBackfill(e)) {
        row.on_hit_effects = JSON.stringify(e.onHitEffects);
        row.active_channel = null;
      }
      if (channelNeedsPassiveBackfill(e)) {
        row.passive_effects = JSON.stringify(e.passiveEffects || []);
        row.has_passive_bonuses = e.hasPassiveBonuses ? 1 : 0;
        row.passive_channel = null;
        if (e.passiveTargetCondition) {
          row.passive_target_condition = JSON.stringify(e.passiveTargetCondition);
        }
        if (e.passiveTargetCount != null) {
          row.passive_target_count = e.passiveTargetCount === 'all' ? -1 : e.passiveTargetCount;
        }
      }
      insertEntity.run(row);
    }
    for (const a of affixes) {
      if (!a?.id || !a?.name) continue;
      const row = affixDefToRow(a);
      if (channelNeedsActiveBackfill(a)) {
        row.on_hit_effects = JSON.stringify(a.onHitEffects);
        row.active_channel = null;
      }
      if (channelNeedsPassiveBackfill(a)) {
        row.passive_effects = JSON.stringify(a.passiveEffects || []);
        row.has_passive_bonuses = a.hasPassiveBonuses ? 1 : 0;
        row.passive_channel = null;
        if (a.passiveTargetCondition) {
          row.passive_target_condition = JSON.stringify(a.passiveTargetCondition);
        }
        if (a.passiveTargetCount != null) {
          row.passive_target_count = a.passiveTargetCount === 'all' ? -1 : a.passiveTargetCount;
        }
      }
      insertAffix.run(row);
    }
  });

  tx();
  console.log(
    `[Seed] 空库已导入种子: ${entities.length} entities, ${affixes.length} affixes, ${effects.length} effects, ${categories.length} categories`
  );
}
