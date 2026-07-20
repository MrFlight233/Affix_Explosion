// ============================================================
// 数据库连接管理 — better-sqlite3 单例 + 生产级 Pragma
// 参考: better-sqlite3 官方最佳实践
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config';

// better-sqlite3 的类型在某些 TS 配置下解析为 namespace，此处直接用 Database 构造函数类型
type DatabaseInstance = InstanceType<typeof Database>;

let _db: DatabaseInstance | null = null;

export function getDB(): DatabaseInstance {
  if (!_db) throw new Error('数据库未初始化，请先调用 initDB()');
  return _db;
}

export function initDB(): void {
  const dbDir = path.dirname(CONFIG.DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  _db = new Database(CONFIG.DB_PATH);

  // ---- 生产级 Pragma 配置 ----
  // WAL 模式：写操作不阻塞读操作
  _db.pragma('journal_mode = WAL');
  // 外键约束（SQLite 默认关闭，必须手动开启）
  _db.pragma('foreign_keys = ON');
  // 并发写等待 5 秒而非立即抛 SQLITE_BUSY
  _db.pragma('busy_timeout = 5000');
  // WAL 模式下 NORMAL 足够安全，比 FULL 快
  _db.pragma('synchronous = NORMAL');
  // 20MB 页面缓存（负值 = KB）
  _db.pragma('cache_size = -20000');
  // 256MB 内存映射 I/O（减少 read() 系统调用）
  _db.pragma('mmap_size = 268435456');
  // 临时表放在内存
  _db.pragma('temp_store = MEMORY');

  console.log('[DB] better-sqlite3 初始化完成 (WAL mode)');
}

/**
 * 优雅关闭：确保 WAL checkpoint 完成后再关闭
 */
export function closeDB(): void {
  if (_db) {
    _db.pragma('wal_checkpoint(TRUNCATE)');
    _db.close();
    _db = null;
    console.log('[DB] 数据库已关闭');
  }
}

// 进程退出时自动关闭
process.on('SIGTERM', () => closeDB());
process.on('SIGINT', () => closeDB());
