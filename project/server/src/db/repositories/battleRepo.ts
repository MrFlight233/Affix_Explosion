// ============================================================
// BattleRepo — 对战池操作
// BD 上传含 defId 合法性校验（防篡改）
// ============================================================

import { getDB } from '../connection';
import { templateCache } from '../cache';

export class BattleRepo {
  /**
   * 上传 BD 到对战池
   * 上传前校验 BD 中所有 defId 是否存在于当前模板数据中
   */
  upload(
    userId: number,
    username: string,
    floor: number,
    round: number,
    bdJson: string,
    powerScore: number,
  ): number {
    if (!floor || !round || !bdJson) {
      throw Object.assign(new Error('缺少参数'), { statusCode: 400 });
    }

    // BD 合法性校验：defId 必须来自当前模板
    try {
      const bd = JSON.parse(bdJson);
      this.validateBdDefIds(bd);
    } catch (e: any) {
      if (e.statusCode) throw e; // 我们的校验错误直接抛出
      throw Object.assign(new Error('BD 数据格式无效'), { statusCode: 400 });
    }

    const db = getDB();
    const result = db.prepare(`
      INSERT INTO battle_pool (user_id, username, floor, round, bd_json, power_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username, floor, round, bdJson, powerScore || 0);

    return Number(result.lastInsertRowid);
  }

  /**
   * 递归校验 BD 中所有 ItemInstance 的 defId 合法性
   */
  private validateBdDefIds(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    // 检查 ItemInstance 的 defId
    if (obj.defId && obj.type) {
      if (obj.type === 'entity') {
        if (!templateCache.getEntity(obj.defId)) {
          throw Object.assign(
            new Error(`BD 包含不存在的实体: ${obj.defId}`),
            { statusCode: 400 },
          );
        }
      } else if (obj.type === 'affix') {
        if (!templateCache.getAffix(obj.defId)) {
          throw Object.assign(
            new Error(`BD 包含不存在的词条: ${obj.defId}`),
            { statusCode: 400 },
          );
        }
      }
    }

    // 递归检查所有子对象
    if (Array.isArray(obj)) {
      for (const item of obj) this.validateBdDefIds(item);
    } else {
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') this.validateBdDefIds(val);
      }
    }
  }

  /** 查询对战池（排除自己的 BD） */
  findByFloorRound(floor: number, round: number, excludeUserId: number): any[] {
    const db = getDB();
    const rows = db.prepare(`
      SELECT id, username, floor, round, bd_json, power_score,
             win_count, loss_count
      FROM battle_pool
      WHERE floor = ? AND round = ? AND user_id != ?
      ORDER BY power_score DESC
      LIMIT 10
    `).all(floor, round, excludeUserId) as any[];

    return rows.map((o: any) => ({
      ...o,
      bd_json: JSON.parse(o.bd_json),
    }));
  }

  /** 更新 BD 战绩（客户端上报） */
  updateStats(bdId: number, win: boolean): void {
    const db = getDB();
    if (win) {
      db.prepare('UPDATE battle_pool SET win_count = win_count + 1 WHERE id = ?').run(bdId);
    } else {
      db.prepare('UPDATE battle_pool SET loss_count = loss_count + 1 WHERE id = ?').run(bdId);
    }
  }
}

export const battleRepo = new BattleRepo();
