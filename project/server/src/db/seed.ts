// ============================================================
// 数据库建表脚本
// ============================================================

import { getDB } from './connection';

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
