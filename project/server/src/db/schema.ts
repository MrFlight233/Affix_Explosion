import initSqlJs, { Database as SqlJsDatabase, Statement } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config';

let _sqlDb: SqlJsDatabase | null = null;
let _saveTimer: NodeJS.Timeout | null = null;

// 防抖保存
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (!_sqlDb) return;
    const dir = path.dirname(CONFIG.DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.DB_PATH, Buffer.from(_sqlDb.export()));
  }, 100);
}

// 立即保存
function saveNow() {
  if (!_sqlDb) return;
  const dir = path.dirname(CONFIG.DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG.DB_PATH, Buffer.from(_sqlDb.export()));
}

// 将 sql.js 包装成兼容 better-sqlite3 的 API
class DbWrapper {
  prepare(sql: string) {
    const self = this;
    return {
      run(...params: any[]) {
        const s = _sqlDb!;
        s.run(sql, params);
        const rows = s.exec('SELECT last_insert_rowid() as id');
        const lastId = rows.length > 0 ? rows[0].values[0][0] as number : 0;
        const changes = s.getRowsModified();
        scheduleSave();
        return { lastInsertRowid: lastId, changes };
      },
      get(...params: any[]): any {
        try {
          const s = _sqlDb!;
          const stmt: Statement = s.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row: any = {};
            cols.forEach((c: string, i: number) => row[c] = vals[i]);
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          console.error('DB get error:', e);
          return undefined;
        }
      },
      all(...params: any[]): any[] {
        try {
          const s = _sqlDb!;
          const stmt: Statement = s.prepare(sql);
          stmt.bind(params);
          const results: any[] = [];
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row: any = {};
            cols.forEach((c: string, i: number) => row[c] = vals[i]);
            results.push(row);
          }
          stmt.free();
          return results;
        } catch (e) {
          console.error('DB all error:', e);
          return [];
        }
      },
    };
  }
  exec(sql: string) {
    _sqlDb!.run(sql);
    scheduleSave();
  }
}

let _wrapper: DbWrapper | null = null;

export async function initDB(): Promise<void> {
  const SQL = await initSqlJs();

  const dbDir = path.dirname(CONFIG.DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(CONFIG.DB_PATH)) {
    const buffer = fs.readFileSync(CONFIG.DB_PATH);
    _sqlDb = new SQL.Database(buffer);
  } else {
    _sqlDb = new SQL.Database();
  }

  _wrapper = new DbWrapper();

  _wrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saves (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
      data_json   TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS battle_pool (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      username    TEXT    NOT NULL,
      floor       INTEGER NOT NULL,
      round       INTEGER NOT NULL,
      bd_json     TEXT    NOT NULL,
      power_score INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('[DB] 数据库初始化完成');
}

export function getDB(): DbWrapper {
  if (!_wrapper) throw new Error('数据库未初始化');
  return _wrapper;
}

// 单例导出（兼容路由中的 import db from '../db/schema'）
const db = new Proxy({} as DbWrapper, {
  get(_target, prop) {
    if (!_wrapper) throw new Error('数据库未初始化');
    return (_wrapper as any)[prop];
  },
});

export default db as DbWrapper;
