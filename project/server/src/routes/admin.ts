import { Router, Response } from 'express';
import { adminMiddleware, AuthRequest } from '../middleware/admin';
import { entityRepo, affixRepo, categoryRepo, templateCache } from '../db';

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

/** 批量导入实体 */
router.post('/entities/import', (req: AuthRequest, res: Response) => {
  const { items, overwrite } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items 必须是非空数组' });
    return;
  }
  const result = { imported: 0, skipped: 0, errors: [] as { index: number; id: string; message: string }[] };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.id || !item.name) {
      result.errors.push({ index: i, id: item?.id || '(缺失)', message: 'ID 和名称不能为空' });
      continue;
    }
    try {
      if (entityRepo.exists(item.id)) {
        if (overwrite) {
          entityRepo.update(item.id, item);
          result.imported++;
        } else {
          result.skipped++;
        }
      } else {
        entityRepo.create(item);
        result.imported++;
      }
    } catch (e: any) {
      result.errors.push({ index: i, id: item.id, message: e.message });
    }
  }
  res.status(result.errors.length > 0 && result.imported === 0 ? 400 : 200).json(result);
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

/** 删除所有实体 */
router.delete('/entities', (_req: AuthRequest, res: Response) => {
  entityRepo.deleteAll();
  res.json({ ok: true, message: '所有实体已删除' });
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

/** 批量导入词条 */
router.post('/affixes/import', (req: AuthRequest, res: Response) => {
  const { items, overwrite } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items 必须是非空数组' });
    return;
  }
  const result = { imported: 0, skipped: 0, errors: [] as { index: number; id: string; message: string }[] };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.id || !item.name) {
      result.errors.push({ index: i, id: item?.id || '(缺失)', message: 'ID 和名称不能为空' });
      continue;
    }
    try {
      if (affixRepo.exists(item.id)) {
        if (overwrite) {
          affixRepo.update(item.id, item);
          result.imported++;
        } else {
          result.skipped++;
        }
      } else {
        affixRepo.create(item);
        result.imported++;
      }
    } catch (e: any) {
      result.errors.push({ index: i, id: item.id, message: e.message });
    }
  }
  res.status(result.errors.length > 0 && result.imported === 0 ? 400 : 200).json(result);
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

/** 删除所有词条 */
router.delete('/affixes', (_req: AuthRequest, res: Response) => {
  affixRepo.deleteAll();
  res.json({ ok: true, message: '所有词条已删除' });
});

// ---- 分类 CRUD ----

/** 获取所有分类 */
router.get('/categories', (_req: AuthRequest, res: Response) => {
  res.json({ categories: categoryRepo.getAll() });
});

/** 获取实体分类标记的分类 ID 列表 */
router.get('/categories/entity-class-ids', (_req: AuthRequest, res: Response) => {
  res.json({ ids: [...categoryRepo.getEntityClassIds()] });
});

/** 新增分类 */
router.post('/categories', (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.body;
    if (!category || !category.id || !category.name) {
      res.status(400).json({ error: '分类 ID 和名称不能为空' });
      return;
    }
    const created = categoryRepo.create(category);
    res.status(201).json({ category: created });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message, refCount: e.refCount });
  }
});

/** 更新分类 */
router.put('/categories/:id', (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.body;
    if (!category) {
      res.status(400).json({ error: '请求体需要 category 字段' });
      return;
    }
    const updated = categoryRepo.update(req.params.id as string, category);
    res.json({ category: updated });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/** 删除分类 */
router.delete('/categories/:id', (req: AuthRequest, res: Response) => {
  try {
    const removed = categoryRepo.delete(req.params.id as string);
    res.json({ ok: true, removed });
  } catch (e: any) {
    res.status(e.statusCode || 500).json({ error: e.message, refCount: e.refCount });
  }
});

export default router;
