import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { templateCache, battleRepo } from '../db';

const router = Router();

// ---- 公开数据端点（从内存缓存读取，零 DB 查询） ----

// GET /api/data/entities
router.get('/entities', (_req: Request, res: Response) => {
  res.json({
    entities: templateCache.getAllEntities(),
    version: templateCache.version,
  });
});

// GET /api/data/affixes
router.get('/affixes', (_req: Request, res: Response) => {
  res.json({
    affixes: templateCache.getAllAffixes(),
    version: templateCache.version,
  });
});

// GET /api/data/all — 一次性获取所有游戏数据
router.get('/all', (_req: Request, res: Response) => {
  res.json({
    entities: templateCache.getAllEntities(),
    affixes: templateCache.getAllAffixes(),
    version: templateCache.version,
  });
});

// ---- 战斗池 ----

// POST /api/data/battle-pool — 上传 BD（含 defId 合法性校验）
router.post('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { floor, round, bd_json, power_score } = req.body;
    const id = battleRepo.upload(
      req.userId!,
      req.username!,
      floor,
      round,
      bd_json,
      power_score || 0,
    );
    res.json({ id });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// GET /api/data/battle-pool?floor=1&round=2 — 获取对战池
router.get('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const floor = parseInt(req.query.floor as string, 10);
  const round = parseInt(req.query.round as string, 10);

  const opponents = battleRepo.findByFloorRound(floor, round, req.userId!);
  res.json({ opponents });
});

export default router;
