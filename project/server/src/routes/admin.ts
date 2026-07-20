import { Router, Response } from 'express';
import { adminMiddleware, AuthRequest } from '../middleware/admin';
import { entityRepo, affixRepo, templateCache } from '../db';

const router = Router();

// 所有 admin 路由都需要 JWT + 管理员白名单
router.use(adminMiddleware);

// ---- 管理员检查 ----

router.get('/check', (req: AuthRequest, res: Response) => {
  res.json({ admin: true, username: req.username });
});

// ---- 实体 CRUD ----

/** 获取所有实体 */
router.get('/entities', (_req: AuthRequest, res: Response) => {
  res.json({
    entities: entityRepo.getAll(),
    version: templateCache.version,
  });
});

/** 获取单个实体 */
router.get('/entities/:id', (req: AuthRequest, res: Response) => {
  const entity = entityRepo.getById(req.params.id as string);
  if (!entity) {
    res.status(404).json({ error: '实体不存在' });
    return;
  }
  res.json({ entity });
});

/** 新增实体 */
router.post('/entities', (req: AuthRequest, res: Response) => {
  try {
    const { entity } = req.body;
    if (!entity || !entity.id || !entity.name) {
      res.status(400).json({ error: '实体 ID 和名称不能为空' });
      return;
    }
    const created = entityRepo.create(entity);
    res.status(201).json({ entity: created });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 更新实体 */
router.put('/entities/:id', (req: AuthRequest, res: Response) => {
  try {
    const { entity } = req.body;
    if (!entity) {
      res.status(400).json({ error: '请求体需要 entity 字段' });
      return;
    }
    const updated = entityRepo.update(req.params.id as string, entity);
    res.json({ entity: updated });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 删除实体 */
router.delete('/entities/:id', (req: AuthRequest, res: Response) => {
  try {
    const removed = entityRepo.delete(req.params.id as string);
    res.json({ ok: true, removed });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ---- 词条 CRUD ----

/** 获取所有词条 */
router.get('/affixes', (_req: AuthRequest, res: Response) => {
  res.json({
    affixes: affixRepo.getAll(),
    version: templateCache.version,
  });
});

/** 获取单个词条 */
router.get('/affixes/:id', (req: AuthRequest, res: Response) => {
  const affix = affixRepo.getById(req.params.id as string);
  if (!affix) {
    res.status(404).json({ error: '词条不存在' });
    return;
  }
  res.json({ affix });
});

/** 新增词条 */
router.post('/affixes', (req: AuthRequest, res: Response) => {
  try {
    const { affix } = req.body;
    if (!affix || !affix.id || !affix.name) {
      res.status(400).json({ error: '词条 ID 和名称不能为空' });
      return;
    }
    const created = affixRepo.create(affix);
    res.status(201).json({ affix: created });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 更新词条 */
router.put('/affixes/:id', (req: AuthRequest, res: Response) => {
  try {
    const { affix } = req.body;
    if (!affix) {
      res.status(400).json({ error: '请求体需要 affix 字段' });
      return;
    }
    const updated = affixRepo.update(req.params.id as string, affix);
    res.json({ affix: updated });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 删除词条 */
router.delete('/affixes/:id', (req: AuthRequest, res: Response) => {
  try {
    const removed = affixRepo.delete(req.params.id as string);
    res.json({ ok: true, removed });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 重置为种子数据 */
router.post('/reset', (_req: AuthRequest, res: Response) => {
  entityRepo.resetAll();
  // resetAll 内部调用 seedFromJson，种子导入后缓存已刷新
  res.json({
    ok: true,
    message: `已重置为默认数据（${templateCache.getAllEntities().length} 实体, ${templateCache.getAllAffixes().length} 词条）`,
  });
});

export default router;
