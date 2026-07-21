// ============================================================
// EntityRepo — 实体模板 CRUD
// 写操作：DB INSERT/UPDATE/DELETE + 内存缓存写穿透
// 读操作：纯内存缓存（零 DB 查询）
// ============================================================

import { getDB } from '../connection';
import { templateCache, entityDefToRow, entityRowToDef } from '../cache';

export class EntityRepo {
  /** 获取所有实体（从缓存，零 DB 查询） */
  getAll(): Record<string, any>[] {
    return templateCache.getAllEntities();
  }

  /** 获取单个实体 */
  getById(id: string): Record<string, any> | undefined {
    return templateCache.getEntity(id);
  }

  /** 检查是否存在 */
  exists(id: string): boolean {
    return templateCache.getEntity(id) !== undefined;
  }

  /**
   * 创建实体
   * @throws 如果 ID 已存在
   */
  create(def: Record<string, any>): Record<string, any> {
    if (this.exists(def.id)) {
      throw Object.assign(new Error(`实体 '${def.id}' 已存在`), { statusCode: 409 });
    }

    // 填充默认值（对应旧 admin.ts 的默认值逻辑）
    const filled = {
      id: def.id,
      name: def.name,
      slotCost: def.slotCost ?? 1,
      entitySlots: def.entitySlots ?? 0,
      weight: def.weight ?? 0,
      value: def.value ?? 1,
      fixedAffixes: def.fixedAffixes ?? [],
      dynamicAffixSlots: def.dynamicAffixSlots ?? 0,
      poolPrerequisite: def.poolPrerequisite ?? [],
      defaultChildren: def.defaultChildren ?? undefined,
      hp: def.hp ?? 0,
      maxStamina: def.maxStamina ?? 0,
      staminaRegen: def.staminaRegen ?? 0,
      maxLoad: def.maxLoad ?? 0,
      isActive: def.isActive ?? false,
      staminaCost: def.staminaCost ?? 0,
      actionTime: def.actionTime ?? 0,
      damage: def.damage ?? 0,
      targetType: def.targetType ?? def.attackType ?? null,
      targetOrder: def.targetOrder ?? def.attackOrder ?? null,
      priorityTarget: def.priorityTarget ?? null,
      targetFaction: def.targetFaction ?? null,
      preloadedDynamicAffixes: def.preloadedDynamicAffixes ?? undefined,
      regenBonus: def.regenBonus ?? 0,
      hpBonus: def.hpBonus ?? 0,
    };

    const db = getDB();
    const row = entityDefToRow(filled);
    db.prepare(`
      INSERT INTO entities (
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
    `).run(row);

    // 写穿透：更新缓存 + 版本号
    templateCache.setEntity(filled);
    templateCache.bumpVersion();

    return filled;
  }

  /**
   * 更新实体（部分字段合并）
   * @throws 如果实体不存在
   */
  update(id: string, patch: Record<string, any>): Record<string, any> {
    const existing = templateCache.getEntity(id);
    if (!existing) {
      throw Object.assign(new Error('实体不存在'), { statusCode: 404 });
    }

    // 合并更新（ID 不可更改）
    const merged: Record<string, any> = {
      ...existing,
      ...patch,
      id, // 锁定 ID
    };

    // 支持清空可选的数组字段：客户端传 null 时显式设为 undefined
    if (patch.defaultChildren === null) merged.defaultChildren = undefined;
    if (patch.preloadedDynamicAffixes === null) merged.preloadedDynamicAffixes = undefined;

    // 兼容旧字段名 attackType/attackOrder
    if (patch.targetType === undefined && patch.attackType !== undefined) {
      merged.targetType = patch.attackType;
    }
    if (patch.targetOrder === undefined && patch.attackOrder !== undefined) {
      merged.targetOrder = patch.attackOrder;
    }

    const db = getDB();
    const row = entityDefToRow(merged);
    db.prepare(`
      UPDATE entities SET
        name=@name, slot_cost=@slot_cost, entity_slots=@entity_slots,
        weight=@weight, value=@value,
        fixed_affixes=@fixed_affixes, dynamic_affix_slots=@dynamic_affix_slots,
        pool_prerequisite=@pool_prerequisite,
        default_children=@default_children, preloaded_dynamic_affixes=@preloaded_dynamic_affixes,
        hp=@hp, max_stamina=@max_stamina, stamina_regen=@stamina_regen, max_load=@max_load,
        is_active=@is_active, stamina_cost=@stamina_cost, action_time=@action_time, damage=@damage,
        target_type=@target_type, target_order=@target_order,
        priority_target=@priority_target, target_faction=@target_faction,
        regen_bonus=@regen_bonus, hp_bonus=@hp_bonus, updated_at=@updated_at
      WHERE id=@id
    `).run(row);

    templateCache.setEntity(merged);
    templateCache.bumpVersion();

    return merged;
  }

  /**
   * 删除实体（含引用完整性检查）
   * 检查所有存档中是否有 ItemInstance 引用了此实体
   */
  delete(id: string): Record<string, any> {
    const existing = templateCache.getEntity(id);
    if (!existing) {
      throw Object.assign(new Error('实体不存在'), { statusCode: 404 });
    }

    // 引用完整性检查：扫描所有 saves 表中的 GameState JSON
    const db = getDB();
    const referencingUsers = db.prepare(`
      SELECT user_id, username FROM saves
      WHERE data_json LIKE ?
    `).all(`%"defId":"${id}"%`) as any[];

    if (referencingUsers.length > 0) {
      const userNames = referencingUsers.map((u: any) => u.username).join(', ');
      throw Object.assign(
        new Error(`无法删除：实体被 ${referencingUsers.length} 个玩家的存档引用（${userNames}），请先通知玩家清理`),
        { statusCode: 409 },
      );
    }

    db.prepare('DELETE FROM entities WHERE id = ?').run(id);

    templateCache.deleteEntity(id);
    templateCache.bumpVersion();

    return existing;
  }

  /** 扫描所有存档中引用指定实体 ID 的 ItemInstance */
  checkReferences(id: string): { userId: number; username: string }[] {
    const db = getDB();
    return db.prepare(`
      SELECT user_id, username FROM saves
      WHERE data_json LIKE ?
    `).all(`%"defId":"${id}"%`) as any[];
  }

  /** 重置为种子数据 */
  resetAll(): void {
    const { seedFromJson } = require('../seed');
    seedFromJson();
  }
}

export const entityRepo = new EntityRepo();
