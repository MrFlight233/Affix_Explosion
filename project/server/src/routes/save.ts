import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db/schema';

const router = Router();

// GET /api/saves — 获取唯一存档
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const save = db.prepare(
    'SELECT data_json, updated_at FROM saves WHERE user_id = ?'
  ).get(req.userId!) as any;

  if (!save) {
    res.json({ save: null });
    return;
  }
  res.json({ save: { data_json: save.data_json, updated_at: save.updated_at } });
});

// PUT /api/saves — 保存（唯一存档，覆盖）
router.put('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const { data_json } = req.body;
  if (!data_json || typeof data_json !== 'string') {
    res.status(400).json({ error: '缺少存档数据' });
    return;
  }
  if (data_json.length > 500_000) {
    res.status(400).json({ error: '存档数据过大' });
    return;
  }

  // 先删后插（实现覆盖）
  db.prepare('DELETE FROM saves WHERE user_id = ?').run(req.userId!);
  db.prepare(
    'INSERT INTO saves (user_id, data_json, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(req.userId!, data_json);

  res.json({ ok: true });
});

// DELETE /api/saves — 删除存档
router.delete('/', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM saves WHERE user_id = ?').run(req.userId!);
  res.json({ ok: true });
});

export default router;
