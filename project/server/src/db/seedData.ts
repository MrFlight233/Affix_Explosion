// ============================================================
// JSON 种子：发布（DB→文件）与空库导入（文件→DB）
// 目录：project/server/data/seed/
// ============================================================

import fs from 'fs';
import path from 'path';
import { getDB } from './connection';
import { templateCache, entityDefToRow, affixDefToRow } from './cache';

/** 种子始终写在服务端工作目录 data/seed/（与 Git 跟踪路径一致；不随 DB_PATH 漂移） */
const SEED_DIR = path.resolve(process.cwd(), 'data/seed');

export interface SeedPublishResult {
  path: string;
  entities: number;
  affixes: number;
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

  const entities = sortById(templateCache.getAllEntities());
  const affixes = sortById(templateCache.getAllAffixes());
  const categories = sortById(templateCache.getAllCategories());
  const exportedAt = new Date().toISOString();
  const version = templateCache.version;

  writeJson(path.join(SEED_DIR, 'entities.json'), entities);
  writeJson(path.join(SEED_DIR, 'affixes.json'), affixes);
  writeJson(path.join(SEED_DIR, 'categories.json'), categories);

  const meta: SeedPublishResult = {
    path: SEED_DIR,
    entities: entities.length,
    affixes: affixes.length,
    categories: categories.length,
    version,
    exportedAt,
  };
  writeJson(path.join(SEED_DIR, 'meta.json'), meta);

  console.log(
    `[Seed] 已发布种子: ${meta.entities} entities, ${meta.affixes} affixes, ${meta.categories} categories → ${SEED_DIR}`
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
  const categoriesPath = path.join(SEED_DIR, 'categories.json');

  if (!fs.existsSync(entitiesPath) && !fs.existsSync(affixesPath) && !fs.existsSync(categoriesPath)) {
    console.log(`[Seed] 未找到种子目录 ${SEED_DIR}，跳过导入`);
    return;
  }

  let entities: any[];
  let affixes: any[];
  let categories: any[];
  try {
    entities = readJsonArray(entitiesPath);
    affixes = readJsonArray(affixesPath);
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

  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (
      id, name, slot_cost, entity_slots, weight, value, fixed_affixes, dynamic_affix_slots,
      pool_prerequisite, default_children, preloaded_dynamic_affixes, hp, max_stamina,
      stamina_regen, hp_regen, max_load, is_active, stamina_cost, action_time, damage, damage_bonus,
      on_hit_effects, target_type, target_order, priority_target, target_faction, target_count,
      target_condition, stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus,
      hp_bonus, load_bonus, has_passive_bonuses, updated_at
    ) VALUES (
      @id, @name, @slot_cost, @entity_slots, @weight, @value, @fixed_affixes, @dynamic_affix_slots,
      @pool_prerequisite, @default_children, @preloaded_dynamic_affixes, @hp, @max_stamina,
      @stamina_regen, @hp_regen, @max_load, @is_active, @stamina_cost, @action_time, @damage, @damage_bonus,
      @on_hit_effects, @target_type, @target_order, @priority_target, @target_faction, @target_count,
      @target_condition, @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus,
      @hp_bonus, @load_bonus, @has_passive_bonuses, @updated_at
    )
  `);

  const insertAffix = db.prepare(`
    INSERT OR REPLACE INTO affixes (
      id, name, category, cost_value, slot_cost, repeatable, prerequisite, pool_prerequisite,
      effect, on_hit_effects, damage_bonus, targeting_modifier, has_passive_bonuses,
      stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus, hp_bonus, load_bonus, updated_at
    ) VALUES (
      @id, @name, @category, @cost_value, @slot_cost, @repeatable, @prerequisite, @pool_prerequisite,
      @effect, @on_hit_effects, @damage_bonus, @targeting_modifier, @has_passive_bonuses,
      @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus, @hp_bonus, @load_bonus, @updated_at
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
    for (const e of entities) {
      if (!e?.id || !e?.name) continue;
      insertEntity.run(entityDefToRow(e));
    }
    for (const a of affixes) {
      if (!a?.id || !a?.name) continue;
      insertAffix.run(affixDefToRow(a));
    }
  });

  tx();
  console.log(
    `[Seed] 空库已导入种子: ${entities.length} entities, ${affixes.length} affixes, ${categories.length} categories`
  );
}
