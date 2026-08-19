import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { templateCache, battleRepo, categoryRepo } from '../db';

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
    effects: templateCache.getAllEffects(),
    categories: templateCache.getAllCategories(),
    version: templateCache.version,
  });
});

router.get('/effects', (_req: Request, res: Response) => {
  res.json({
    effects: templateCache.getAllEffects(),
    version: templateCache.version,
  });
});

// ---- 战斗池 ----

// POST /api/data/battle-pool — 上传 BD（含 defId 合法性校验）
router.post('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { round, bd_json } = req.body;
    const id = battleRepo.upload(
      req.userId!,
      req.username!,
      round,
      bd_json,
    );
    res.json({ id });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// GET /api/data/battle-pool?round=2 — 随机获取 1 个对手
router.get('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const round = parseInt(req.query.round as string, 10);

  const opponent = battleRepo.findByRound(round);
  res.json({ opponent });
});

export default router;
