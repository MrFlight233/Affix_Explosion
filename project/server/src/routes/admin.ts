import { Router, Response } from 'express';
import { adminMiddleware, AuthRequest } from '../middleware/admin';
import { loadGameData, saveGameData } from './data';

const router = Router();

// 所有 admin 路由都需要 JWT + 管理员白名单
router.use(adminMiddleware);

// ---- 管理员检查 ----

/** 检查当前用户是否为管理员（返回成功即说明是管理员，因为 middleware 已拦截） */
router.get('/check', (req: AuthRequest, res: Response) => {
  res.json({ admin: true, username: req.username });
});

// ---- 实体 CRUD ----

/** 获取所有实体 */
router.get('/entities', (_req: AuthRequest, res: Response) => {
  const data = loadGameData();
  res.json({ entities: data.entities, version: data.version });
});

/** 获取单个实体 */
router.get('/entities/:id', (req: AuthRequest, res: Response) => {
  const data = loadGameData();
  const entity = data.entities.find((e: any) => e.id === req.params.id);
  if (!entity) {
    res.status(404).json({ error: '实体不存在' });
    return;
  }
  res.json({ entity });
});

/** 新增实体 */
router.post('/entities', (req: AuthRequest, res: Response) => {
  const { entity } = req.body;
  if (!entity || !entity.id || !entity.name) {
    res.status(400).json({ error: '实体 ID 和名称不能为空' });
    return;
  }

  const data = loadGameData();
  const existing = data.entities.find((e: any) => e.id === entity.id);
  if (existing) {
    res.status(409).json({ error: `实体 '${entity.id}' 已存在，请使用 PUT 更新` });
    return;
  }

  // 填充默认值
  const newEntity = {
    id: entity.id,
    name: entity.name,
    slotCost: entity.slotCost ?? 1,
    entitySlots: entity.entitySlots ?? 0,
    weight: entity.weight ?? 0,
    value: entity.value ?? 1,
    fixedAffixes: entity.fixedAffixes ?? [],
    dynamicAffixSlots: entity.dynamicAffixSlots ?? 0,
    poolPrerequisite: entity.poolPrerequisite ?? [],
    defaultChildren: entity.defaultChildren ?? undefined,
    hp: entity.hp ?? 0,
    maxStamina: entity.maxStamina ?? 0,
    staminaRegen: entity.staminaRegen ?? 0,
    maxLoad: entity.maxLoad ?? 0,
    isActive: entity.isActive ?? false,
    staminaCost: entity.staminaCost ?? 0,
    actionTime: entity.actionTime ?? 0,
    damage: entity.damage ?? 0,
    attackType: entity.attackType ?? null,
    attackOrder: entity.attackOrder ?? null,
    priorityTarget: entity.priorityTarget ?? null,
    armorBonus: entity.armorBonus ?? 0,
    regenBonus: entity.regenBonus ?? 0,
    hpBonus: entity.hpBonus ?? 0,
  };

  data.entities.push(newEntity);
  data.version++;
  saveGameData(data);

  res.status(201).json({ entity: newEntity });
});

/** 更新实体 */
router.put('/entities/:id', (req: AuthRequest, res: Response) => {
  const { entity } = req.body;
  if (!entity) {
    res.status(400).json({ error: '请求体需要 entity 字段' });
    return;
  }

  const data = loadGameData();
  const idx = data.entities.findIndex((e: any) => e.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '实体不存在' });
    return;
  }

  // 合并更新（保留原 ID）
  const existing = data.entities[idx];
  const updated = {
    id: req.params.id, // ID 不可更改
    name: entity.name ?? existing.name,
    slotCost: entity.slotCost ?? existing.slotCost,
    entitySlots: entity.entitySlots ?? existing.entitySlots,
    weight: entity.weight ?? existing.weight,
    value: entity.value ?? existing.value,
    fixedAffixes: entity.fixedAffixes ?? existing.fixedAffixes,
    dynamicAffixSlots: entity.dynamicAffixSlots ?? existing.dynamicAffixSlots,
    poolPrerequisite: entity.poolPrerequisite ?? existing.poolPrerequisite,
    defaultChildren: entity.defaultChildren !== undefined ? entity.defaultChildren : existing.defaultChildren,
    hp: entity.hp ?? existing.hp,
    maxStamina: entity.maxStamina ?? existing.maxStamina,
    staminaRegen: entity.staminaRegen ?? existing.staminaRegen,
    maxLoad: entity.maxLoad ?? existing.maxLoad,
    isActive: entity.isActive ?? existing.isActive,
    staminaCost: entity.staminaCost ?? existing.staminaCost,
    actionTime: entity.actionTime ?? existing.actionTime,
    damage: entity.damage ?? existing.damage,
    attackType: entity.attackType !== undefined ? entity.attackType : existing.attackType,
    attackOrder: entity.attackOrder !== undefined ? entity.attackOrder : existing.attackOrder,
    priorityTarget: entity.priorityTarget !== undefined ? entity.priorityTarget : existing.priorityTarget,
    armorBonus: entity.armorBonus ?? existing.armorBonus,
    regenBonus: entity.regenBonus ?? existing.regenBonus,
    hpBonus: entity.hpBonus ?? existing.hpBonus,
  };

  data.entities[idx] = updated;
  data.version++;
  saveGameData(data);

  res.json({ entity: updated });
});

/** 删除实体 */
router.delete('/entities/:id', (req: AuthRequest, res: Response) => {
  const data = loadGameData();
  const idx = data.entities.findIndex((e: any) => e.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '实体不存在' });
    return;
  }

  const removed = data.entities.splice(idx, 1)[0];
  data.version++;
  saveGameData(data);

  res.json({ ok: true, removed });
});

// ---- 词条 CRUD ----

/** 获取所有词条 */
router.get('/affixes', (_req: AuthRequest, res: Response) => {
  const data = loadGameData();
  res.json({ affixes: data.affixes, version: data.version });
});

/** 获取单个词条 */
router.get('/affixes/:id', (req: AuthRequest, res: Response) => {
  const data = loadGameData();
  const affix = data.affixes.find((a: any) => a.id === req.params.id);
  if (!affix) {
    res.status(404).json({ error: '词条不存在' });
    return;
  }
  res.json({ affix });
});

/** 新增词条 */
router.post('/affixes', (req: AuthRequest, res: Response) => {
  const { affix } = req.body;
  if (!affix || !affix.id || !affix.name) {
    res.status(400).json({ error: '词条 ID 和名称不能为空' });
    return;
  }

  const data = loadGameData();
  const existing = data.affixes.find((a: any) => a.id === affix.id);
  if (existing) {
    res.status(409).json({ error: `词条 '${affix.id}' 已存在，请使用 PUT 更新` });
    return;
  }

  const newAffix = {
    id: affix.id,
    name: affix.name,
    category: affix.category ?? '特殊',
    value: affix.value ?? 0,
    costValue: affix.costValue ?? 0,
    slotCost: affix.slotCost ?? 0,
    repeatable: affix.repeatable ?? false,
    prerequisite: affix.prerequisite ?? [],
    poolPrerequisite: affix.poolPrerequisite ?? [],
    target: affix.target ?? '通用',
    effect: affix.effect ?? '',
  };

  data.affixes.push(newAffix);
  data.version++;
  saveGameData(data);

  res.status(201).json({ affix: newAffix });
});

/** 更新词条 */
router.put('/affixes/:id', (req: AuthRequest, res: Response) => {
  const { affix } = req.body;
  if (!affix) {
    res.status(400).json({ error: '请求体需要 affix 字段' });
    return;
  }

  const data = loadGameData();
  const idx = data.affixes.findIndex((a: any) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '词条不存在' });
    return;
  }

  const existing = data.affixes[idx];
  const updated = {
    id: req.params.id,
    name: affix.name ?? existing.name,
    category: affix.category ?? existing.category,
    value: affix.value ?? existing.value,
    costValue: affix.costValue ?? existing.costValue,
    slotCost: affix.slotCost ?? existing.slotCost,
    repeatable: affix.repeatable ?? existing.repeatable,
    prerequisite: affix.prerequisite ?? existing.prerequisite,
    poolPrerequisite: affix.poolPrerequisite ?? existing.poolPrerequisite,
    target: affix.target ?? existing.target,
    effect: affix.effect ?? existing.effect,
  };

  data.affixes[idx] = updated;
  data.version++;
  saveGameData(data);

  res.json({ affix: updated });
});

/** 删除词条 */
router.delete('/affixes/:id', (req: AuthRequest, res: Response) => {
  const data = loadGameData();
  const idx = data.affixes.findIndex((a: any) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '词条不存在' });
    return;
  }

  const removed = data.affixes.splice(idx, 1)[0];
  data.version++;
  saveGameData(data);

  res.json({ ok: true, removed });
});

/** 重置为默认数据 */
router.post('/reset', (_req: AuthRequest, res: Response) => {
  const fs = require('fs');
  const path = require('path');
  const seedPath = path.resolve(__dirname, '../../data/game_data.json');

  if (!fs.existsSync(seedPath)) {
    res.status(500).json({ error: '默认数据文件不存在' });
    return;
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  seed.version = 1;
  saveGameData(seed);

  res.json({ ok: true, message: `已重置为默认数据（${seed.entities.length} 实体, ${seed.affixes.length} 词条）` });
});

export default router;
