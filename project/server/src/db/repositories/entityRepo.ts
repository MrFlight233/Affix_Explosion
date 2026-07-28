// ============================================================
// EntityRepo — 实体模板 CRUD
// 写操作：DB INSERT/UPDATE/DELETE + 写后回读入缓存（缓存 ≡ DB）
// 读操作：纯内存缓存（零 DB 查询）
// ============================================================

import { getDB } from '../connection';
import { templateCache, entityDefToRow, entityRowToDef } from '../cache';

/** 写库后从 DB 回读，保证缓存与库一致 */
function reloadEntityIntoCache(id: string): Record<string, any> {
  const db = getDB();
  const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Record<string, any>;
  const persisted = entityRowToDef(row);
  templateCache.setEntity(persisted);
  templateCache.bumpVersion();
  return persisted;
}

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
      hpRegen: def.hpRegen ?? 0,
      maxLoad: def.maxLoad ?? 0,
      isActive: def.isActive ?? false,
      staminaCost: def.staminaCost ?? 0,
      actionTime: def.actionTime ?? 0,
      damage: def.damage ?? 0,
      damageBonus: def.damageBonus ?? 0,
      targetType: def.targetType ?? def.attackType ?? null,
      targetOrder: def.targetOrder ?? def.attackOrder ?? null,
      priorityTarget: def.priorityTarget ?? null,
      targetFaction: def.targetFaction ?? null,
      // null = 显式无条件 Targeting
      targetCondition: def.targetCondition != null ? def.targetCondition : undefined,
      preloadedDynamicAffixes: def.preloadedDynamicAffixes ?? undefined,
      staminaRegenerationBonus: def.staminaRegenerationBonus ?? 0,
      staminaBonus: def.staminaBonus ?? 0,
      hpRegenerationBonus: def.hpRegenerationBonus ?? 0,
      hpBonus: def.hpBonus ?? 0,
      loadBonus: def.loadBonus ?? 0,
      hasPassiveBonuses: def.hasPassiveBonuses ?? false,
    };

    const db = getDB();
    const row = entityDefToRow(filled);
    db.prepare(`
      INSERT INTO entities (
        id, name, slot_cost, entity_slots, weight, value,
        fixed_affixes, dynamic_affix_slots, pool_prerequisite,
        default_children, preloaded_dynamic_affixes,
        hp, max_stamina, stamina_regen, hp_regen, max_load,
        is_active, stamina_cost, action_time, damage, damage_bonus,
        target_type, target_order, priority_target, target_faction, target_condition,
        stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus, hp_bonus,
        load_bonus, has_passive_bonuses, updated_at
      ) VALUES (
        @id, @name, @slot_cost, @entity_slots, @weight, @value,
        @fixed_affixes, @dynamic_affix_slots, @pool_prerequisite,
        @default_children, @preloaded_dynamic_affixes,
        @hp, @max_stamina, @stamina_regen, @hp_regen, @max_load,
        @is_active, @stamina_cost, @action_time, @damage, @damage_bonus,
        @target_type, @target_order, @priority_target, @target_faction, @target_condition,
        @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus, @hp_bonus,
        @load_bonus, @has_passive_bonuses, @updated_at
      )
    `).run(row);

    return reloadEntityIntoCache(filled.id);
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

    // 支持清空可选字段：客户端传 null 时显式设为 undefined
    if (patch.defaultChildren === null) merged.defaultChildren = undefined;
    if (patch.preloadedDynamicAffixes === null) merged.preloadedDynamicAffixes = undefined;
    if (patch.targetCondition === null) merged.targetCondition = undefined;

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
        hp=@hp, max_stamina=@max_stamina, stamina_regen=@stamina_regen, hp_regen=@hp_regen, max_load=@max_load,
        is_active=@is_active, stamina_cost=@stamina_cost, action_time=@action_time, damage=@damage, damage_bonus=@damage_bonus,
        target_type=@target_type, target_order=@target_order,
        priority_target=@priority_target, target_faction=@target_faction, target_condition=@target_condition,
        stamina_regeneration_bonus=@stamina_regeneration_bonus, stamina_bonus=@stamina_bonus,
        hp_regeneration_bonus=@hp_regeneration_bonus, hp_bonus=@hp_bonus,
        load_bonus=@load_bonus, has_passive_bonuses=@has_passive_bonuses,
        updated_at=@updated_at
      WHERE id=@id
    `).run(row);

    return reloadEntityIntoCache(id);
  }

  /**
   * 删除实体
   */
  delete(id: string): Record<string, any> {
    const existing = templateCache.getEntity(id);
    if (!existing) {
      throw Object.assign(new Error('实体不存在'), { statusCode: 404 });
    }

    const db = getDB();
    db.prepare('DELETE FROM entities WHERE id = ?').run(id);

    templateCache.deleteEntity(id);
    templateCache.bumpVersion();

    return existing;
  }

  /** 删除所有实体 */
  deleteAll(): void {
    const db = getDB();
    db.prepare('DELETE FROM entities').run();
    templateCache.load();  // 全量重载缓存（也重新加载了 version）
  }
}

export const entityRepo = new EntityRepo();
