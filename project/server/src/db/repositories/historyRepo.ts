// 爬塔历史归档 — 多局记录，新游戏不清除
import { getDB } from '../connection';

export class HistoryRepo {
  listByUser(userId: number): { id: number; run_json: string; created_at: string }[] {
    const db = getDB();
    return db.prepare(
      'SELECT id, run_json, created_at FROM run_history WHERE user_id = ? ORDER BY id DESC',
    ).all(userId) as any[];
  }

  getById(userId: number, id: number): { id: number; run_json: string; created_at: string } | null {
    const db = getDB();
    const row = db.prepare(
      'SELECT id, run_json, created_at FROM run_history WHERE user_id = ? AND id = ?',
    ).get(userId, id) as any;
    return row || null;
  }

  /** 通关归档一整局 JSON */
  insert(userId: number, runJson: string): number {
    if (!runJson || typeof runJson !== 'string') {
      throw Object.assign(new Error('缺少归档数据'), { statusCode: 400 });
    }
    if (runJson.length > 2_000_000) {
      throw Object.assign(new Error('归档数据过大'), { statusCode: 400 });
    }
    const db = getDB();
    const info = db.prepare(
      "INSERT INTO run_history (user_id, run_json, created_at) VALUES (?, ?, datetime('now'))",
    ).run(userId, runJson);
    return Number(info.lastInsertRowid);
  }
}

export const historyRepo = new HistoryRepo();
