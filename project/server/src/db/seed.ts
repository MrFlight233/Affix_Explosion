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
      round       INTEGER NOT NULL,
      bd_json     TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_battle_pool_round ON battle_pool(round);

    CREATE TABLE IF NOT EXISTS categories (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      is_entity_class INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ---- 迁移：删除旧版 battle_pool 废弃字段 ----
  migrateBattlePool(db);

  console.log('[DB] 所有表创建/验证完成');
}

/** 迁移 battle_pool 表：删除 floor/power_score/win_count/loss_count 列 */
function migrateBattlePool(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('battle_pool')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    if (colNames.has('floor') || colNames.has('power_score') ||
        colNames.has('win_count') || colNames.has('loss_count')) {
      // 重建表（SQLite 3.35+ 支持 DROP COLUMN，但重建更通用）
      db.exec(`
        CREATE TABLE IF NOT EXISTS battle_pool_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL REFERENCES users(id),
          username    TEXT NOT NULL,
          round       INTEGER NOT NULL,
          bd_json     TEXT NOT NULL,
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO battle_pool_new (id, user_id, username, round, bd_json, uploaded_at)
          SELECT id, user_id, username, round, bd_json,
                 COALESCE(uploaded_at, datetime('now'))
          FROM battle_pool;
        DROP TABLE battle_pool;
        ALTER TABLE battle_pool_new RENAME TO battle_pool;
      `);
      console.log('[DB] battle_pool 表已迁移：删除 floor/power_score/win_count/loss_count 列');
    }

    // 重建索引
    db.exec(`
      DROP INDEX IF EXISTS idx_battle_pool_floor_round;
      DROP INDEX IF EXISTS idx_battle_pool_power;
      CREATE INDEX IF NOT EXISTS idx_battle_pool_round ON battle_pool(round);
    `);
  } catch (e) {
    console.warn('[DB] battle_pool 迁移跳过:', (e as Error).message);
  }
}
