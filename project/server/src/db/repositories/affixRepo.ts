// ============================================================
// AffixRepo — 词条模板 CRUD
// 写操作：DB INSERT/UPDATE/DELETE + 内存缓存写穿透
// 读操作：纯内存缓存
// ============================================================

import { getDB } from '../connection';
import { templateCache, affixDefToRow } from '../cache';

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

    const filled = {
      id: def.id,
      name: def.name,
      category: def.category ?? '特殊',
      value: def.value ?? 0,
      costValue: def.costValue ?? 0,
      slotCost: def.slotCost ?? 0,
      repeatable: def.repeatable ?? false,
      prerequisite: def.prerequisite ?? [],
      poolPrerequisite: def.poolPrerequisite ?? [],
      target: def.target ?? '通用',
      effect: def.effect ?? '',
    };

    const db = getDB();
    db.prepare(`
      INSERT INTO affixes (
        id, name, category, value, cost_value, slot_cost,
        repeatable, prerequisite, pool_prerequisite, target, effect, updated_at
      ) VALUES (
        @id, @name, @category, @value, @cost_value, @slot_cost,
        @repeatable, @prerequisite, @pool_prerequisite, @target, @effect, @updated_at
      )
    `).run(affixDefToRow(filled));

    templateCache.setAffix(filled);
    templateCache.bumpVersion();

    return filled;
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

    const db = getDB();
    db.prepare(`
      UPDATE affixes SET
        name=@name, category=@category, value=@value, cost_value=@cost_value,
        slot_cost=@slot_cost, repeatable=@repeatable,
        prerequisite=@prerequisite, pool_prerequisite=@pool_prerequisite,
        target=@target, effect=@effect, updated_at=@updated_at
      WHERE id=@id
    `).run(affixDefToRow(merged));

    templateCache.setAffix(merged);
    templateCache.bumpVersion();

    return merged;
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
