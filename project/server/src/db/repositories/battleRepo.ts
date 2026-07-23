// ============================================================
// BattleRepo — 对战池操作
// BD 上传含 defId 合法性校验（防篡改）
// ============================================================

import { getDB } from '../connection';
import { templateCache } from '../cache';

export class BattleRepo {
  /**
   * 上传 BD 到对战池
   * 同用户同回合先删旧记录，再插入新记录；上传前校验 defId 合法性
   */
  upload(
    userId: number,
    username: string,
    round: number,
    bdJson: string,
  ): number {
    if (!round || !bdJson) {
      throw Object.assign(new Error('缺少参数'), { statusCode: 400 });
    }

    // BD 合法性校验：defId 必须来自当前模板
    try {
      const bd = JSON.parse(bdJson);
      this.validateBdDefIds(bd);
    } catch (e: any) {
      if (e.statusCode) throw e;
      throw Object.assign(new Error('BD 数据格式无效'), { statusCode: 400 });
    }

    const db = getDB();

    // 校验用户是否存在（DB 重置后旧 token 可能导致 userId 无效）
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw Object.assign(new Error('用户不存在，请重新登录'), { statusCode: 401 });
    }

    // 纯 INSERT，允许多条（同一用户同回合可上传多次，抽取时按概率自然分布）
    const result = db.prepare(`
      INSERT INTO battle_pool (user_id, username, round, bd_json)
      VALUES (?, ?, ?, ?)
    `).run(userId, username, round, bdJson);

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

  /** 随机抽取指定回合的 1 个对手 BD（含自己），池空返回 null。
   *  两步随机：先取最近 100 条（走主键索引），再 JS 侧随机选取。 */
  findByRound(round: number): any | null {
    const db = getDB();

    // 第一步：用主键索引高效取最近 100 条（无全表扫描）
    const pool = db.prepare(`
      SELECT id, username, round, bd_json
      FROM battle_pool
      WHERE round = ?
      ORDER BY id DESC
      LIMIT 100
    `).all(round) as any[];

    if (pool.length === 0) return null;

    // 第二步：从 100 条内存池中随机取 1 条
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return { ...picked, bd_json: JSON.parse(picked.bd_json) };
  }
}

export const battleRepo = new BattleRepo();
