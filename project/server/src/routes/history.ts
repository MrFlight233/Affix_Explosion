import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { historyRepo } from '../db/repositories/historyRepo';

const router = Router();

function summarizeBattles(battles: any[]): { wins: number; losses: number; battles: number } {
  const list = Array.isArray(battles) ? battles : [];
  let wins = 0;
  let losses = 0;
  for (const b of list) {
    if (b?.result === 'win' || b?.result === 'auto_win') wins++;
    else if (b?.result === 'loss') losses++;
  }
  return { wins, losses, battles: list.length };
}

/** GET /api/history — 列出当前用户爬塔归档 */
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = historyRepo.listByUser(req.userId!);
  res.json({
    runs: rows.map(r => {
      let summary: any = {};
      try { summary = JSON.parse(r.run_json); } catch { /* ignore */ }
      const stats = summarizeBattles(summary.battles);
      return {
        id: r.id,
        created_at: r.created_at,
        status: summary.status === 'cleared' ? 'cleared' : (stats.battles > 0 ? (summary.status || 'in_progress') : 'in_progress'),
        wins: stats.wins,
        losses: stats.losses,
        maxRound: summary.maxRound,
        battles: stats.battles,
        gold: summary.gold,
      };
    }),
  });
});

/** GET /api/history/:id — 单局详情 */
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const row = historyRepo.getById(req.userId!, id);
  if (!row) {
    res.status(404).json({ error: '归档不存在' });
    return;
  }
  res.json({ id: row.id, created_at: row.created_at, run: JSON.parse(row.run_json) });
});

/** POST /api/history — 创建归档（首战） */
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { run } = req.body || {};
    if (!run || typeof run !== 'object') {
      res.status(400).json({ error: '缺少 run' });
      return;
    }
    const id = historyRepo.insert(req.userId!, JSON.stringify(run));
    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** PUT /api/history/:id — 增量更新本局 */
router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: '无效 id' });
      return;
    }
    const { run } = req.body || {};
    if (!run || typeof run !== 'object') {
      res.status(400).json({ error: '缺少 run' });
      return;
    }
    const ok = historyRepo.update(req.userId!, id, JSON.stringify(run));
    if (!ok) {
      res.status(404).json({ error: '归档不存在' });
      return;
    }
    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

export default router;
