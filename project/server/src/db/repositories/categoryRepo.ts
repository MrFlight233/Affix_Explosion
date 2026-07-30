// ============================================================
// CategoryRepo — 词条分类 CRUD
// 写操作：DB INSERT/UPDATE/DELETE + 内存缓存写穿透
// 读操作：纯内存缓存
// ============================================================

import { getDB } from '../connection';
import { templateCache } from '../cache';

export class CategoryRepo {
  getAll(): Record<string, any>[] {
    return templateCache.getAllCategories();
  }

  getById(id: string): Record<string, any> | undefined {
    return templateCache.getCategory(id);
  }

  exists(id: string): boolean {
    return templateCache.getCategory(id) !== undefined;
  }

  create(def: Record<string, any>): Record<string, any> {
    if (!def.id || !def.name) {
      throw Object.assign(new Error('分类 ID 和名称不能为空'), { statusCode: 400 });
    }
    if (this.exists(def.id)) {
      throw Object.assign(new Error(`分类 '${def.id}' 已存在`), { statusCode: 409 });
    }

    const filled = {
      id: def.id,
      name: def.name,
      sortOrder: def.sortOrder ?? 0,
      isEntityClass: def.isEntityClass ?? false,
      showInFilter: def.showInFilter ?? true,
    };

    const db = getDB();
    db.prepare(`
      INSERT INTO categories (id, name, sort_order, is_entity_class, show_in_filter, updated_at)
      VALUES (@id, @name, @sort_order, @is_entity_class, @show_in_filter, @updated_at)
    `).run({
      id: filled.id,
      name: filled.name,
      sort_order: filled.sortOrder,
      is_entity_class: filled.isEntityClass ? 1 : 0,
      show_in_filter: filled.showInFilter ? 1 : 0,
      updated_at: new Date().toISOString(),
    });

    templateCache.setCategory(filled);
    templateCache.bumpVersion();

    return filled;
  }

  update(id: string, patch: Record<string, any>): Record<string, any> {
    const existing = templateCache.getCategory(id);
    if (!existing) {
      throw Object.assign(new Error('分类不存在'), { statusCode: 404 });
    }

    const merged: Record<string, any> = {
      ...existing,
      ...patch,
      id, // 锁定 ID
    };

    const db = getDB();
    db.prepare(`
      UPDATE categories SET
        name=@name, sort_order=@sort_order, is_entity_class=@is_entity_class,
        show_in_filter=@show_in_filter, updated_at=@updated_at
      WHERE id=@id
    `).run({
      id: merged.id,
      name: merged.name,
      sort_order: merged.sortOrder ?? 0,
      is_entity_class: merged.isEntityClass ? 1 : 0,
      show_in_filter: (merged.showInFilter !== false) ? 1 : 0,
      updated_at: new Date().toISOString(),
    });

    templateCache.setCategory(merged);
    templateCache.bumpVersion();

    return merged;
  }

  delete(id: string): Record<string, any> {
    const existing = templateCache.getCategory(id);
    if (!existing) {
      throw Object.assign(new Error('分类不存在'), { statusCode: 404 });
    }

    // 检查是否有词条引用此分类
    const db = getDB();
    const refCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM affixes WHERE category = ?').get(id) as any
    ).cnt;
    if (refCount > 0) {
      throw Object.assign(
        new Error(`有 ${refCount} 个词条引用此分类，无法删除`),
        { statusCode: 409, refCount }
      );
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id);

    templateCache.deleteCategory(id);
    templateCache.bumpVersion();

    return existing;
  }

  /** 返回所有 is_entity_class=1 的分类 ID 集合 */
  getEntityClassIds(): Set<string> {
    return templateCache.getEntityClassCategoryIds();
  }
}

export const categoryRepo = new CategoryRepo();
