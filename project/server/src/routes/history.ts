import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { historyRepo } from '../db/repositories/historyRepo';

const router = Router();

/** GET /api/history — 列出当前用户爬塔归档 */
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = historyRepo.listByUser(req.userId!);
  res.json({
    runs: rows.map(r => {
      let summary: any = {};
      try { summary = JSON.parse(r.run_json); } catch { /* ignore */ }
      return {
        id: r.id,
        created_at: r.created_at,
        maxRound: summary.maxRound,
        battles: Array.isArray(summary.battles) ? summary.battles.length : 0,
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

/** POST /api/history — 通关写入归档 */
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

export default router;
