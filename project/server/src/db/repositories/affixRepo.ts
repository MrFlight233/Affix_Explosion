// ============================================================
// AffixRepo — 词条模板 CRUD
// 写操作：DB INSERT/UPDATE/DELETE + 写后回读入缓存（缓存 ≡ DB）
// 读操作：纯内存缓存
// ============================================================

import { getDB } from '../connection';
import { templateCache, affixDefToRow, affixRowToDef } from '../cache';

function validateCategory(category: string): void {
  if (!templateCache.getCategory(category)) {
    throw Object.assign(
      new Error(`无效的分类: '${category}'，请使用管理员页面管理分类`),
      { statusCode: 400 }
    );
  }
}

/** 写库后从 DB 回读，保证缓存与库一致 */
function reloadAffixIntoCache(id: string): Record<string, any> {
  const db = getDB();
  const row = db.prepare('SELECT * FROM affixes WHERE id = ?').get(id) as Record<string, any>;
  const persisted = affixRowToDef(row);
  templateCache.setAffix(persisted);
  templateCache.bumpVersion();
  return persisted;
}

export class AffixRepo {
  getAll(): Record<string, any>[] {
    return templateCache.getAllAffixes();
  }

  getById(id: string): Record<string, any> | undefined {
    return templateCache.getAffix(id);
  }

  exists(id: string): boolean {
    return templateCache.getAffix(id) !== undefined;
  }

  create(def: Record<string, any>): Record<string, any> {
    if (this.exists(def.id)) {
      throw Object.assign(new Error(`词条 '${def.id}' 已存在`), { statusCode: 409 });
    }

    validateCategory(def.category ?? '特殊');

    const filled = {
      id: def.id,
      name: def.name,
      category: def.category ?? '特殊',
      costValue: def.costValue ?? 0,
      slotCost: def.slotCost ?? 0,
      repeatable: def.repeatable ?? false,
      prerequisite: def.prerequisite ?? [],
      poolPrerequisite: def.poolPrerequisite ?? [],
      effect: def.effect ?? '',
      onHitEffects: def.onHitEffects ?? [],
      staminaRegenerationBonus: def.staminaRegenerationBonus ?? 0,
      staminaBonus: def.staminaBonus ?? 0,
      hpRegenerationBonus: def.hpRegenerationBonus ?? 0,
      hpBonus: def.hpBonus ?? 0,
      loadBonus: def.loadBonus ?? 0,
      // null = 显式无覆写
      targetingModifier: def.targetingModifier != null ? def.targetingModifier : undefined,
      hasPassiveBonuses: def.hasPassiveBonuses ?? false,
      passiveEffects: def.passiveEffects ?? [],
      passiveTargetCondition: def.passiveTargetCondition,
      passiveTargetCount: def.passiveTargetCount ?? null,
      activeChannel: def.activeChannel,
      passiveChannel: def.passiveChannel,
      description: def.description ?? def.effect ?? '',
    };

    const db = getDB();
    db.prepare(`
      INSERT INTO affixes (
        id, name, category, cost_value, slot_cost,
        repeatable, prerequisite, pool_prerequisite, effect, on_hit_effects,
        damage_bonus, stamina_regeneration_bonus, stamina_bonus, hp_regeneration_bonus, hp_bonus,
        load_bonus, targeting_modifier, has_passive_bonuses,
        passive_effects, passive_target_condition, passive_target_count,
        active_channel, passive_channel,
        updated_at
      ) VALUES (
        @id, @name, @category, @cost_value, @slot_cost,
        @repeatable, @prerequisite, @pool_prerequisite, @effect, @on_hit_effects,
        @damage_bonus, @stamina_regeneration_bonus, @stamina_bonus, @hp_regeneration_bonus, @hp_bonus,
        @load_bonus, @targeting_modifier, @has_passive_bonuses,
        @passive_effects, @passive_target_condition, @passive_target_count,
        @active_channel, @passive_channel,
        @updated_at
      )
    `).run(affixDefToRow(filled));

    return reloadAffixIntoCache(filled.id);
  }

  update(id: string, patch: Record<string, any>): Record<string, any> {
    const existing = templateCache.getAffix(id);
    if (!existing) {
      throw Object.assign(new Error('词条不存在'), { statusCode: 404 });
    }

    const merged: Record<string, any> = {
      ...existing,
      ...patch,
      id,
    };

    // 客户端传 null 表示清除 Targeting 覆写
    if (patch.targetingModifier === null) merged.targetingModifier = undefined;

    validateCategory(merged.category ?? 'special');

    const db = getDB();
    db.prepare(`
      UPDATE affixes SET
        name=@name, category=@category, cost_value=@cost_value,
        slot_cost=@slot_cost, repeatable=@repeatable,
        prerequisite=@prerequisite, pool_prerequisite=@pool_prerequisite,
        effect=@effect, on_hit_effects=@on_hit_effects,
        damage_bonus=@damage_bonus, stamina_regeneration_bonus=@stamina_regeneration_bonus,
        stamina_bonus=@stamina_bonus, hp_regeneration_bonus=@hp_regeneration_bonus,
        hp_bonus=@hp_bonus, load_bonus=@load_bonus,
        targeting_modifier=@targeting_modifier, has_passive_bonuses=@has_passive_bonuses,
        passive_effects=@passive_effects, passive_target_condition=@passive_target_condition,
        passive_target_count=@passive_target_count,
        active_channel=@active_channel, passive_channel=@passive_channel,
        updated_at=@updated_at
      WHERE id=@id
    `).run(affixDefToRow(merged));

    return reloadAffixIntoCache(id);
  }

  delete(id: string): Record<string, any> {
    const existing = templateCache.getAffix(id);
    if (!existing) {
      throw Object.assign(new Error('词条不存在'), { statusCode: 404 });
    }

    const db = getDB();
    db.prepare('DELETE FROM affixes WHERE id = ?').run(id);

    templateCache.deleteAffix(id);
    templateCache.bumpVersion();

    return existing;
  }

  /** 删除所有词条 */
  deleteAll(): void {
    const db = getDB();
    db.prepare('DELETE FROM affixes').run();
    templateCache.load();  // 全量重载缓存
  }
}

export const affixRepo = new AffixRepo();
