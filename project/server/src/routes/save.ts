import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { saveRepo } from '../db';

const router = Router();

// GET /api/saves — 获取唯一存档
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const save = saveRepo.getByUserId(req.userId!);
  if (!save) {
    res.json({ save: null });
    return;
  }
  res.json({ save });
});

// PUT /api/saves — 保存（唯一存档，覆盖）
router.put('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { data_json } = req.body;
    saveRepo.save(req.userId!, data_json);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// DELETE /api/saves — 删除存档
router.delete('/', authMiddleware, (req: AuthRequest, res: Response) => {
  saveRepo.deleteByUserId(req.userId!);
  res.json({ ok: true });
});

export default router;
