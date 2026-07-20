// ============================================================
// 种子数据脚本 — 从 game_data.json 导入现有模板到 DB
// 首次启动 / 管理员 reset 时调用
// ============================================================

import fs from 'fs';
import path from 'path';
import { getDB } from './connection';
import { entityDefToRow, affixDefToRow, templateCache } from './cache';
import { CONFIG } from '../config';

const SEED_PATH = path.resolve(CONFIG.SEED_DATA_PATH);

/** 从 JSON 种子文件导入模板数据到数据库表 */
export function seedFromJson(): void {
  const db = getDB();

  if (!fs.existsSync(SEED_PATH)) {
    console.warn(`[Seed] 种子文件不存在: ${SEED_PATH}，跳过导入`);
    return;
  }

  const raw = fs.readFileSync(SEED_PATH, 'utf-8');
  const data = JSON.parse(raw);

  // 使用事务批量写入
  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (
      id, name, slot_cost, entity_slots, weight, value,
      fixed_affixes, dynamic_affix_slots, pool_prerequisite,
      default_children, preloaded_dynamic_affixes,
      hp, max_stamina, stamina_regen, max_load,
      is_active, stamina_cost, action_time, damage,
      target_type, target_order, priority_target, target_faction,
      regen_bonus, hp_bonus, updated_at
    ) VALUES (
      @id, @name, @slot_cost, @entity_slots, @weight, @value,
      @fixed_affixes, @dynamic_affix_slots, @pool_prerequisite,
      @default_children, @preloaded_dynamic_affixes,
      @hp, @max_stamina, @stamina_regen, @max_load,
      @is_active, @stamina_cost, @action_time, @damage,
      @target_type, @target_order, @priority_target, @target_faction,
      @regen_bonus, @hp_bonus, @updated_at
    )
  `);

  const insertAffix = db.prepare(`
    INSERT OR REPLACE INTO affixes (
      id, name, category, value, cost_value, slot_cost,
      repeatable, prerequisite, pool_prerequisite, target, effect, updated_at
    ) VALUES (
      @id, @name, @category, @value, @cost_value, @slot_cost,
      @repeatable, @prerequisite, @pool_prerequisite, @target, @effect, @updated_at
    )
  `);

  const transaction = db.transaction(() => {
    // 清空旧数据
    db.prepare('DELETE FROM entities').run();
    db.prepare('DELETE FROM affixes').run();

    for (const entityDef of (data.entities || [])) {
      insertEntity.run(entityDefToRow(entityDef));
    }
    for (const affixDef of (data.affixes || [])) {
      insertAffix.run(affixDefToRow(affixDef));
    }

    // 重置版本号为 1
    db.prepare('INSERT OR REPLACE INTO data_version (id, version) VALUES (1, 1)').run();
  });

  transaction();

  console.log(`[Seed] 种子数据导入完成: ${data.entities?.length ?? 0} entities, ${data.affixes?.length ?? 0} affixes`);

  // 刷新缓存
  templateCache.load();
}

/** 首次启动时建表 + 导入种子数据 */
export function initTables(): void {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slot_cost   INTEGER NOT NULL DEFAULT 1,
      entity_slots INTEGER NOT NULL DEFAULT 0,
      weight      INTEGER NOT NULL DEFAULT 0,
      value       INTEGER NOT NULL DEFAULT 0,
      fixed_affixes TEXT NOT NULL DEFAULT '[]',
      dynamic_affix_slots INTEGER NOT NULL DEFAULT 0,
      pool_prerequisite TEXT NOT NULL DEFAULT '[]',
      default_children TEXT,
      preloaded_dynamic_affixes TEXT,
      hp          INTEGER NOT NULL DEFAULT 10,
      max_stamina INTEGER NOT NULL DEFAULT 50,
      stamina_regen INTEGER NOT NULL DEFAULT 5,
      max_load    INTEGER NOT NULL DEFAULT 20,
      is_active   INTEGER NOT NULL DEFAULT 0,
      stamina_cost INTEGER NOT NULL DEFAULT 0,
      action_time INTEGER NOT NULL DEFAULT 0,
      damage      INTEGER NOT NULL DEFAULT 0,
      target_type TEXT,
      target_order TEXT,
      priority_target INTEGER,
      target_faction TEXT,
      regen_bonus INTEGER NOT NULL DEFAULT 0,
      hp_bonus    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS affixes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '特殊',
      value       INTEGER NOT NULL DEFAULT 0,
      cost_value  INTEGER NOT NULL DEFAULT 0,
      slot_cost   INTEGER NOT NULL DEFAULT 1,
      repeatable  INTEGER NOT NULL DEFAULT 0,
      prerequisite TEXT NOT NULL DEFAULT '[]',
      pool_prerequisite TEXT NOT NULL DEFAULT '[]',
      target      TEXT NOT NULL DEFAULT 'self',
      effect      TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saves (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
      data_json   TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS battle_pool (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      username    TEXT NOT NULL,
      floor       INTEGER NOT NULL,
      round       INTEGER NOT NULL,
      bd_json     TEXT NOT NULL,
      power_score INTEGER NOT NULL DEFAULT 0,
      win_count   INTEGER NOT NULL DEFAULT 0,
      loss_count  INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_battle_pool_floor_round ON battle_pool(floor, round);
    CREATE INDEX IF NOT EXISTS idx_battle_pool_power ON battle_pool(power_score);
  `);

  console.log('[DB] 所有表创建/验证完成');
}
