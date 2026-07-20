// ============================================================
// SaveRepo — 玩家存档读写
// 一个用户一个存档，PUT 覆盖
// ============================================================

import { getDB } from '../connection';

const MAX_SAVE_SIZE = 500_000; // 500KB

export class SaveRepo {
  /** 获取用户存档 */
  getByUserId(userId: number): { data_json: string; updated_at: string } | null {
    const db = getDB();
    const row = db.prepare(
      'SELECT data_json, updated_at FROM saves WHERE user_id = ?',
    ).get(userId) as any;

    if (!row) return null;
    return { data_json: row.data_json, updated_at: row.updated_at };
  }

  /**
   * 保存存档（先删后插，实现覆盖）
   * @throws 如果数据过大
   */
  save(userId: number, dataJson: string): void {
    if (!dataJson || typeof dataJson !== 'string') {
      throw Object.assign(new Error('缺少存档数据'), { statusCode: 400 });
    }
    if (dataJson.length > MAX_SAVE_SIZE) {
      throw Object.assign(new Error('存档数据过大'), { statusCode: 400 });
    }

    const db = getDB();
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM saves WHERE user_id = ?').run(userId);
      db.prepare(
        "INSERT INTO saves (user_id, data_json, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(userId, dataJson);
    });

    transaction();
  }

  /** 删除用户存档 */
  deleteByUserId(userId: number): void {
    const db = getDB();
    db.prepare('DELETE FROM saves WHERE user_id = ?').run(userId);
  }
}

export const saveRepo = new SaveRepo();
