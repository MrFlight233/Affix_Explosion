// ============================================================
// Drizzle ORM Schema — 表定义
// + 过渡兼容层：保持旧路由 import 不报错
// ============================================================

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { getDB as _getDB, initDB as _initDB } from './connection';
import { initTables } from './seed';
import { templateCache } from './cache';

// ========== 模板表 ==========

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slotCost: integer('slot_cost').notNull().default(1),
  entitySlots: integer('entity_slots').notNull().default(0),
  weight: integer('weight').notNull().default(0),
  value: integer('value').notNull().default(0),
  fixedAffixes: text('fixed_affixes').notNull().default('[]'),
  dynamicAffixSlots: integer('dynamic_affix_slots').notNull().default(0),
  poolPrerequisite: text('pool_prerequisite').notNull().default('[]'),
  defaultChildren: text('default_children'),
  preloadedDynamicAffixes: text('preloaded_dynamic_affixes'),
  hp: integer('hp').notNull().default(10),
  maxStamina: integer('max_stamina').notNull().default(50),
  staminaRegen: integer('stamina_regen').notNull().default(5),
  hpRegen: integer('hp_regen').notNull().default(0),
  maxLoad: integer('max_load').notNull().default(20),
  isActive: integer('is_active').notNull().default(0),
  staminaCost: integer('stamina_cost').notNull().default(0),
  actionTime: integer('action_time').notNull().default(0),
  damage: integer('damage').notNull().default(0),
  damageBonus: integer('damage_bonus').notNull().default(0),
  targetType: text('target_type'),
  targetOrder: text('target_order'),
  priorityTarget: integer('priority_target'),
  targetFaction: text('target_faction'),
  staminaRegenerationBonus: integer('stamina_regeneration_bonus').notNull().default(0),
  staminaBonus: integer('stamina_bonus').notNull().default(0),
  hpRegenerationBonus: integer('hp_regeneration_bonus').notNull().default(0),
  hpBonus: integer('hp_bonus').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const affixes = sqliteTable('affixes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull().default('特殊'),
  value: integer('value').notNull().default(0),
  costValue: integer('cost_value').notNull().default(0),
  slotCost: integer('slot_cost').notNull().default(1),
  repeatable: integer('repeatable').notNull().default(0),
  prerequisite: text('prerequisite').notNull().default('[]'),
  poolPrerequisite: text('pool_prerequisite').notNull().default('[]'),
  target: text('target').notNull().default('self'),
  effect: text('effect').notNull().default(''),
  onHitEffects: text('on_hit_effects').notNull().default('[]'),
  staminaRegenerationBonus: integer('stamina_regeneration_bonus').notNull().default(0),
  staminaBonus: integer('stamina_bonus').notNull().default(0),
  hpRegenerationBonus: integer('hp_regeneration_bonus').notNull().default(0),
  hpBonus: integer('hp_bonus').notNull().default(0),
  damageBonus: integer('damage_bonus').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const dataVersion = sqliteTable('data_version', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull().default(1),
});

// ========== 业务表 ==========

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

export const saves = sqliteTable('saves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique().references(() => users.id),
  dataJson: text('data_json').notNull(),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const battlePool = sqliteTable(
  'battle_pool',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id),
    username: text('username').notNull(),
    floor: integer('floor').notNull(),
    round: integer('round').notNull(),
    bdJson: text('bd_json').notNull(),
    powerScore: integer('power_score').notNull().default(0),
    winCount: integer('win_count').notNull().default(0),
    lossCount: integer('loss_count').notNull().default(0),
    uploadedAt: text('uploaded_at').notNull().default("(datetime('now'))"),
  },
  (table) => [
    index('idx_battle_pool_floor_round').on(table.floor, table.round),
    index('idx_battle_pool_power').on(table.powerScore),
  ],
);

// ============================================================
// 过渡兼容层 — 保持旧路由 (save.ts, auth.ts, data.ts) 不报错
// ============================================================

/** 初始化数据库：建立连接 + 建表 + 加载缓存 */
export async function initDB(): Promise<void> {
  _initDB();
  initTables();
  templateCache.load();
}

/**
 * 懒加载 Proxy：延迟绑定 better-sqlite3 Database 实例
 * 与旧 DbWrapper 的 prepare/run/get/all/exec API 兼容
 */
const dbProxy = new Proxy({} as any, {
  get(_target, prop) {
    const db = _getDB();
    const val = (db as any)[prop];
    if (typeof val === 'function') {
      return val.bind(db);
    }
    return val;
  },
});

export default dbProxy;
