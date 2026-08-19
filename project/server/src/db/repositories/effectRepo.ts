// ============================================================
// EffectRepo — 效果库模板 CRUD
// ============================================================

import { getDB } from '../connection';
import { templateCache, effectDefToRow, effectRowToDef } from '../cache';
import { normalizeEffectDef } from '@shared/effectDef';

function reloadEffectIntoCache(id: string): Record<string, any> {
  const db = getDB();
  const row = db.prepare('SELECT * FROM effects WHERE id = ?').get(id) as Record<string, any>;
  const persisted = effectRowToDef(row);
  templateCache.setEffect(persisted);
  templateCache.bumpVersion();
  return persisted;
}

function countReferences(effectId: string): number {
  const db = getDB();
  let n = 0;
  const tables = [
    { table: 'entities', col: 'active_channel' },
    { table: 'entities', col: 'passive_channel' },
    { table: 'affixes', col: 'active_channel' },
    { table: 'affixes', col: 'passive_channel' },
  ];
  for (const t of tables) {
    try {
      const rows = db.prepare(`SELECT ${t.col} AS ch FROM ${t.table}`).all() as { ch: string }[];
      for (const r of rows) {
        if (!r.ch) continue;
        try {
          const ch = JSON.parse(r.ch);
          const bindings = ch?.effectBindings;
          if (!Array.isArray(bindings)) continue;
          for (const b of bindings) {
            if (b?.effectId === effectId) n++;
          }
        } catch { /* ignore */ }
      }
    } catch { /* column missing */ }
  }
  return n;
}

export class EffectRepo {
  getAll(): Record<string, any>[] {
    return templateCache.getAllEffects();
  }

  getById(id: string): Record<string, any> | undefined {
    return templateCache.getEffect(id);
  }

  exists(id: string): boolean {
    return templateCache.getEffect(id) !== undefined;
  }

  countRefs(id: string): number {
    return countReferences(id);
  }

  create(def: Record<string, any>): Record<string, any> {
    const normalized = normalizeEffectDef(def);
    if (!normalized) {
      throw Object.assign(new Error('效果定义无效'), { statusCode: 400 });
    }
    if (this.exists(normalized.id)) {
      throw Object.assign(new Error(`效果 '${normalized.id}' 已存在`), { statusCode: 409 });
    }
    const db = getDB();
    const row = effectDefToRow(normalized);
    db.prepare(`
      INSERT INTO effects (
        id, name, description, allow_active, allow_passive, kind, stat, op,
        default_params, default_duration_ms, default_tick_interval_ms,
        default_display_name, default_apply_to, param_schema, category, updated_at
      ) VALUES (
        @id, @name, @description, @allow_active, @allow_passive, @kind, @stat, @op,
        @default_params, @default_duration_ms, @default_tick_interval_ms,
        @default_display_name, @default_apply_to, @param_schema, @category, @updated_at
      )
    `).run(row);
    return reloadEffectIntoCache(normalized.id);
  }

  update(id: string, patch: Record<string, any>): Record<string, any> {
    const existing = this.getById(id);
    if (!existing) {
      throw Object.assign(new Error('效果不存在'), { statusCode: 404 });
    }
    const merged = normalizeEffectDef({ ...existing, ...patch, id });
    if (!merged) {
      throw Object.assign(new Error('效果定义无效'), { statusCode: 400 });
    }
    const db = getDB();
    const row = effectDefToRow(merged);
    db.prepare(`
      UPDATE effects SET
        name=@name, description=@description, allow_active=@allow_active, allow_passive=@allow_passive,
        kind=@kind, stat=@stat, op=@op, default_params=@default_params,
        default_duration_ms=@default_duration_ms, default_tick_interval_ms=@default_tick_interval_ms,
        default_display_name=@default_display_name, default_apply_to=@default_apply_to,
        param_schema=@param_schema, category=@category, updated_at=@updated_at
      WHERE id=@id
    `).run(row);
    return reloadEffectIntoCache(id);
  }

  delete(id: string): void {
    if (!this.exists(id)) {
      throw Object.assign(new Error('效果不存在'), { statusCode: 404 });
    }
    const refs = countReferences(id);
    if (refs > 0) {
      throw Object.assign(new Error(`效果仍被 ${refs} 处引用，无法删除`), { statusCode: 409 });
    }
    const db = getDB();
    db.prepare('DELETE FROM effects WHERE id = ?').run(id);
    templateCache.deleteEffect(id);
    templateCache.bumpVersion();
  }
}

export const effectRepo = new EffectRepo();
