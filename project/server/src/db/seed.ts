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
      hp_regen    INTEGER NOT NULL DEFAULT 0,
      max_load    INTEGER NOT NULL DEFAULT 20,
      is_active   INTEGER NOT NULL DEFAULT 0,
      stamina_cost INTEGER NOT NULL DEFAULT 0,
      action_time INTEGER NOT NULL DEFAULT 0,
      damage      INTEGER NOT NULL DEFAULT 0,
      damage_bonus INTEGER NOT NULL DEFAULT 0,
      on_hit_effects TEXT NOT NULL DEFAULT '[]',
      target_type TEXT,
      target_order TEXT,
      priority_target INTEGER,
      target_faction TEXT,
      target_count INTEGER,
      target_condition TEXT,
      stamina_regeneration_bonus INTEGER NOT NULL DEFAULT 0,
      stamina_bonus INTEGER NOT NULL DEFAULT 0,
      hp_regeneration_bonus INTEGER NOT NULL DEFAULT 0,
      hp_bonus    INTEGER NOT NULL DEFAULT 0,
      load_bonus  INTEGER NOT NULL DEFAULT 0,
      has_passive_bonuses INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS affixes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '特殊',
      cost_value  INTEGER NOT NULL DEFAULT 0,
      slot_cost   INTEGER NOT NULL DEFAULT 1,
      repeatable  INTEGER NOT NULL DEFAULT 0,
      prerequisite TEXT NOT NULL DEFAULT '[]',
      pool_prerequisite TEXT NOT NULL DEFAULT '[]',
      effect      TEXT NOT NULL DEFAULT '',
      on_hit_effects TEXT NOT NULL DEFAULT '[]',
      damage_bonus INTEGER NOT NULL DEFAULT 0,
      stamina_regeneration_bonus INTEGER NOT NULL DEFAULT 0,
      stamina_bonus INTEGER NOT NULL DEFAULT 0,
      hp_regeneration_bonus INTEGER NOT NULL DEFAULT 0,
      hp_bonus INTEGER NOT NULL DEFAULT 0,
      load_bonus INTEGER NOT NULL DEFAULT 0,
      targeting_modifier TEXT,
      has_passive_bonuses INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS run_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      run_json    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_run_history_user ON run_history(user_id);

    CREATE TABLE IF NOT EXISTS categories (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      is_entity_class INTEGER NOT NULL DEFAULT 0,
      show_in_filter  INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ---- 迁移：删除旧版 battle_pool 废弃字段 ----
  migrateBattlePool(db);
  // ---- 迁移：被动加成字段扩展（regen_bonus → stamina_regeneration_bonus + 新增3列） ----
  migrateStaminaBonusFields(db);
  // ---- 迁移：damage_bonus 字段拆分 ----
  migrateDamageBonus(db);
  // ---- 迁移：affixes 表新增 on_hit_effects 列 ----
  migrateAffixOnHitEffects(db);
  // ---- 迁移：entities.on_hit_effects + 旧 damage / 词条 damage_bonus 注入 ----
  migrateEntityOnHitEffects(db);
  // ---- 迁移：affixes 表新增被动加成 5 列 ----
  migrateAffixPassiveBonuses(db);
  // ---- 迁移：v6 targeting 体系（target_condition + targeting_modifier） ----
  migrateTargetingV6(db);
  // ---- 迁移：v7 被动加成总开关（has_passive_bonuses） ----
  migrateAffixPassiveBonusesToggleV7(db);
  // ---- 迁移：v8 实体被动总开关 + 负重加成 ----
  migrateLoadBonusAndEntityPassiveToggleV8(db);
  // ---- 迁移：categories 表新增 show_in_filter ----
  migrateCategoryShowInFilter(db);
  // ---- 迁移：v9 目标数量 target_count ----
  migrateTargetCountV9(db);

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

/** 迁移 entities 表：被动加成字段扩展（幂等） */
function migrateStaminaBonusFields(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    // 0. 最旧迁移：regen_bonus → stamina_bonus
    if (colNames.has('regen_bonus') && !colNames.has('stamina_regeneration_bonus') && !colNames.has('stamina_bonus')) {
      db.exec('ALTER TABLE entities RENAME COLUMN regen_bonus TO stamina_bonus');
      colNames.add('stamina_bonus'); colNames.delete('regen_bonus');
      console.log('[DB] entities 表已迁移：regen_bonus → stamina_bonus');
    }

    // 1. stamina_bonus → stamina_regeneration_bonus（语义对齐）
    if (colNames.has('stamina_bonus') && !colNames.has('stamina_regeneration_bonus')) {
      db.exec('ALTER TABLE entities RENAME COLUMN stamina_bonus TO stamina_regeneration_bonus');
      console.log('[DB] entities 表已迁移：stamina_bonus → stamina_regeneration_bonus');
    }

    // 2. 新增 stamina_bonus（全新语义：耐力加成）
    if (!colNames.has('stamina_bonus')) {
      db.exec('ALTER TABLE entities ADD COLUMN stamina_bonus INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] entities 表已迁移：添加 stamina_bonus 列（耐力加成）');
    }

    // 3. 新增 hp_regeneration_bonus
    if (!colNames.has('hp_regeneration_bonus')) {
      db.exec('ALTER TABLE entities ADD COLUMN hp_regeneration_bonus INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] entities 表已迁移：添加 hp_regeneration_bonus 列（生命恢复加成）');
    }

    // 4. 新增 hp_regen（实体自身战斗属性）
    if (!colNames.has('hp_regen')) {
      db.exec('ALTER TABLE entities ADD COLUMN hp_regen INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] entities 表已迁移：添加 hp_regen 列（生命恢复/秒）');
    }
  } catch (e) {
    console.warn('[DB] 被动加成字段迁移跳过:', (e as Error).message);
  }
}

/** 迁移 entities 表：damage → damage + damageBonus 字段拆分（幂等） */
function migrateDamageBonus(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    if (!colNames.has('damage_bonus')) {
      db.exec('ALTER TABLE entities ADD COLUMN damage_bonus INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] entities 表已迁移：添加 damage_bonus 列');
      // 将现有 isActive=false 实体的 damage 值迁移到 damageBonus
      const result = db.prepare(
        "UPDATE entities SET damage_bonus = damage, damage = 0 WHERE is_active = 0 AND damage != 0"
      ).run();
      console.log(`[DB] damage_bonus 数据迁移完成：${result.changes} 行`);
    }
  } catch (e) {
    console.warn('[DB] damage_bonus 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 affixes 表：新增 on_hit_effects 列（命中效果 JSON 数组） */
function migrateAffixOnHitEffects(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('affixes')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    if (!colNames.has('on_hit_effects')) {
      db.exec('ALTER TABLE affixes ADD COLUMN on_hit_effects TEXT NOT NULL DEFAULT \'[]\'');
      console.log('[DB] affixes 表已迁移：添加 on_hit_effects 列（命中效果）');
    }
  } catch (e) {
    console.warn('[DB] affixes on_hit_effects 迁移跳过:', (e as Error).message);
  }
}

/** entities.on_hit_effects 列；旧 damage→效果；词条 damage_bonus→伤害效果（幂等） */
function migrateEntityOnHitEffects(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('on_hit_effects')) {
      db.exec("ALTER TABLE entities ADD COLUMN on_hit_effects TEXT NOT NULL DEFAULT '[]'");
      console.log('[DB] entities 表已迁移：添加 on_hit_effects 列');
    }

    const entities = db.prepare('SELECT id, damage, is_active, on_hit_effects FROM entities').all() as {
      id: string; damage: number; is_active: number; on_hit_effects: string;
    }[];
    const update = db.prepare('UPDATE entities SET on_hit_effects = ?, damage = 0 WHERE id = ?');
    for (const row of entities) {
      let list: any[] = [];
      try { list = JSON.parse(row.on_hit_effects || '[]'); } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      const hasHp = list.some((e: any) =>
        (e && e.stat === 'hp' && (e.op === 'loss' || e.op === 'gain'))
        || e?.type === 'damage' || e?.type === 'heal' || e?.type === 'life_steal'
      );
      if (!hasHp && row.is_active === 1 && row.damage) {
        if (row.damage > 0) {
          list.unshift({
            displayName: '伤害', stat: 'hp', op: 'loss',
            params: { amount: row.damage }, applyTo: ['target'],
          });
        } else {
          list.unshift({
            displayName: '回复', stat: 'hp', op: 'gain',
            params: { amount: Math.abs(row.damage) }, applyTo: ['target'],
          });
        }
        update.run(JSON.stringify(list), row.id);
      }
    }

    // strength 等：damage_bonus → 一条伤害命中效果（仅当 on_hit 尚无 hp/loss）
    const affixes = db.prepare('SELECT id, damage_bonus, on_hit_effects FROM affixes').all() as {
      id: string; damage_bonus: number; on_hit_effects: string;
    }[];
    const updA = db.prepare('UPDATE affixes SET on_hit_effects = ?, damage_bonus = 0 WHERE id = ?');
    for (const row of affixes) {
      if (!row.damage_bonus) continue;
      let list: any[] = [];
      try { list = JSON.parse(row.on_hit_effects || '[]'); } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      const hasDmg = list.some((e: any) =>
        (e && e.stat === 'hp' && e.op === 'loss') || e?.type === 'damage'
      );
      if (!hasDmg) {
        list.push({
          displayName: '伤害',
          stat: 'hp',
          op: 'loss',
          params: { amount: row.damage_bonus },
          applyTo: ['target'],
        });
        updA.run(JSON.stringify(list), row.id);
      } else {
        updA.run(JSON.stringify(list), row.id);
      }
    }
    console.log('[DB] entities/affixes 命中效果迁移完成');
  } catch (e) {
    console.warn('[DB] entities on_hit_effects 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 affixes 表：新增被动加成 5 列 + 种子数据映射（幂等） */
function migrateAffixPassiveBonuses(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('affixes')").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    // 1. 添加缺失的列
    const newCols = [
      { sql: 'damage_bonus', name: 'damage_bonus' },
      { sql: 'stamina_regeneration_bonus', name: 'stamina_regeneration_bonus' },
      { sql: 'stamina_bonus', name: 'stamina_bonus' },
      { sql: 'hp_regeneration_bonus', name: 'hp_regeneration_bonus' },
      { sql: 'hp_bonus', name: 'hp_bonus' },
    ];

    for (const col of newCols) {
      if (!colNames.has(col.name)) {
        db.exec(`ALTER TABLE affixes ADD COLUMN ${col.sql} INTEGER NOT NULL DEFAULT 0`);
        console.log(`[DB] affixes 表已迁移：添加 ${col.name} 列（被动加成）`);
      }
    }

    // 2. 种子数据映射（将已知词条的 value 映射到对应被动加成字段）
    //    SQLite 的 UPDATE 幂等安全：多次执行也不会破坏数据
    const mappings: { id: string; col: string; val: number }[] = [
      { id: 'strength',       col: 'damage_bonus',                val: 2 },
      { id: 'constitution',   col: 'hp_bonus',                    val: 20 },
      { id: 'endurance',      col: 'stamina_bonus',               val: 50 },
      { id: 'willpower',      col: 'stamina_regeneration_bonus',  val: 3 },
      { id: 'combat_regen',   col: 'hp_regeneration_bonus',       val: 2 },
    ];

    for (const m of mappings) {
      // value 列在 v9 可能已删除；仅当列仍存在时做历史回填
      if (!colNames.has('value')) break;
      const row = db.prepare('SELECT value FROM affixes WHERE id = ?').get(m.id) as any;
      if (row && row.value !== 0) {
        db.prepare(`UPDATE affixes SET ${m.col} = ? WHERE id = ? AND ${m.col} = 0`).run(m.val, m.id);
      }
    }
    console.log('[DB] affixes 被动加成数据迁移完成');
  } catch (e) {
    console.warn('[DB] affixes 被动加成迁移跳过:', (e as Error).message);
  }
}

/** 迁移 v6：entities 表新增 target_condition 列 + affixes 表新增 targeting_modifier 列 */
function migrateTargetingV6(db: ReturnType<typeof getDB>): void {
  try {
    // entities.target_condition
    const eCols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    if (!eCols.some(c => c.name === 'target_condition')) {
      db.exec(`ALTER TABLE entities ADD COLUMN target_condition TEXT`);
      console.log('[DB] entities 表已迁移：添加 target_condition 列（v6）');
    }

    // affixes.targeting_modifier
    const aCols = db.prepare("PRAGMA table_info('affixes')").all() as { name: string }[];
    if (!aCols.some(c => c.name === 'targeting_modifier')) {
      db.exec(`ALTER TABLE affixes ADD COLUMN targeting_modifier TEXT`);
      console.log('[DB] affixes 表已迁移：添加 targeting_modifier 列（v6）');
    }
  } catch (e) {
    console.warn('[DB] v6 targeting 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 v7：affixes 表新增 has_passive_bonuses 列 + 首次回填旧数据（幂等，后续重启不覆盖手动修改） */
function migrateAffixPassiveBonusesToggleV7(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('affixes')").all() as { name: string }[];
    if (!cols.some(c => c.name === 'has_passive_bonuses')) {
      db.exec('ALTER TABLE affixes ADD COLUMN has_passive_bonuses INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] affixes 表已迁移：添加 has_passive_bonuses 列（v7）');
      // 回填旧数据：仅首次迁移时执行，后续重启不再覆盖
      const result = db.prepare(`UPDATE affixes SET has_passive_bonuses = 1
        WHERE (damage_bonus IS NOT NULL AND damage_bonus != 0)
           OR (hp_bonus IS NOT NULL AND hp_bonus != 0)
           OR (stamina_bonus IS NOT NULL AND stamina_bonus != 0)
           OR (hp_regeneration_bonus IS NOT NULL AND hp_regeneration_bonus != 0)
           OR (stamina_regeneration_bonus IS NOT NULL AND stamina_regeneration_bonus != 0)`).run();
      console.log(`[DB] affixes has_passive_bonuses 回填完成：${result.changes} 行（v7）`);
    }
  } catch (e) {
    console.warn('[DB] v7 has_passive_bonuses 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 v8：entities/affixes 负重加成 + entities 被动总开关（幂等；实体开关仅缺列时回填） */
function migrateLoadBonusAndEntityPassiveToggleV8(db: ReturnType<typeof getDB>): void {
  try {
    const entityCols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    const entityColNames = new Set(entityCols.map(c => c.name));
    let entityPassiveColAdded = false;

    if (!entityColNames.has('load_bonus')) {
      db.exec('ALTER TABLE entities ADD COLUMN load_bonus INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] entities 表已迁移：添加 load_bonus 列（v8）');
    }
    if (!entityColNames.has('has_passive_bonuses')) {
      db.exec('ALTER TABLE entities ADD COLUMN has_passive_bonuses INTEGER NOT NULL DEFAULT 0');
      entityPassiveColAdded = true;
      console.log('[DB] entities 表已迁移：添加 has_passive_bonuses 列（v8）');
    }
    if (entityPassiveColAdded) {
      const result = db.prepare(`UPDATE entities SET has_passive_bonuses = 1
        WHERE (damage_bonus IS NOT NULL AND damage_bonus != 0)
           OR (hp_bonus IS NOT NULL AND hp_bonus != 0)
           OR (stamina_bonus IS NOT NULL AND stamina_bonus != 0)
           OR (hp_regeneration_bonus IS NOT NULL AND hp_regeneration_bonus != 0)
           OR (stamina_regeneration_bonus IS NOT NULL AND stamina_regeneration_bonus != 0)
           OR (load_bonus IS NOT NULL AND load_bonus != 0)`).run();
      console.log(`[DB] entities has_passive_bonuses 回填完成：${result.changes} 行（v8）`);
    }

    const affixCols = db.prepare("PRAGMA table_info('affixes')").all() as { name: string }[];
    if (!affixCols.some(c => c.name === 'load_bonus')) {
      db.exec('ALTER TABLE affixes ADD COLUMN load_bonus INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] affixes 表已迁移：添加 load_bonus 列（v8）');
    }
  } catch (e) {
    console.warn('[DB] v8 load_bonus/has_passive_bonuses 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 categories 表：新增 show_in_filter（筛选中显示，默认 1） */
function migrateCategoryShowInFilter(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('categories')").all() as { name: string }[];
    if (!cols.some(c => c.name === 'show_in_filter')) {
      db.exec('ALTER TABLE categories ADD COLUMN show_in_filter INTEGER NOT NULL DEFAULT 1');
      console.log('[DB] categories 表已迁移：添加 show_in_filter 列');
    }
  } catch (e) {
    console.warn('[DB] categories show_in_filter 迁移跳过:', (e as Error).message);
  }
}

/** 迁移 entities：目标数量 target_count（null=默认1；-1=全部） */
function migrateTargetCountV9(db: ReturnType<typeof getDB>): void {
  try {
    const cols = db.prepare("PRAGMA table_info('entities')").all() as { name: string }[];
    if (!cols.some(c => c.name === 'target_count')) {
      db.exec('ALTER TABLE entities ADD COLUMN target_count INTEGER');
      console.log('[DB] entities 表已迁移：添加 target_count 列');
    }
  } catch (e) {
    console.warn('[DB] entities target_count 迁移跳过:', (e as Error).message);
  }
}
