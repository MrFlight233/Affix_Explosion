import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db/schema';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config';

const router = Router();

// ---- 游戏静态数据管理器 ----

interface GameData {
  entities: any[];
  affixes: any[];
  version: number;
}

let _cachedData: GameData | null = null;

function getDataPath(): string {
  return path.resolve(CONFIG.GAME_DATA_PATH);
}

export function loadGameData(): GameData {
  const dataPath = getDataPath();
  if (!fs.existsSync(dataPath)) {
    // 首次运行：写入默认种子数据（如果存在）
    const seedPath = path.resolve(__dirname, '../../data/game_data.json');
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
      _cachedData = seed;
      return seed;
    }
    // 如果种子数据也不存在，返回空数据
    const empty: GameData = { entities: [], affixes: [], version: 1 };
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(empty, null, 2), 'utf-8');
    _cachedData = empty;
    return empty;
  }
  const raw = fs.readFileSync(dataPath, 'utf-8');
  _cachedData = JSON.parse(raw);
  return _cachedData!;
}

export function saveGameData(data: GameData): void {
  const dataPath = getDataPath();
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _cachedData = data;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
}

// 启动时加载
loadGameData();

// ---- 公开数据端点 ----

// GET /api/data/entities
router.get('/entities', (_req: Request, res: Response) => {
  const data = loadGameData();
  res.json({ entities: data.entities, version: data.version });
});

// GET /api/data/affixes
router.get('/affixes', (_req: Request, res: Response) => {
  const data = loadGameData();
  res.json({ affixes: data.affixes, version: data.version });
});

// GET /api/data/all — 一次性获取所有游戏数据
router.get('/all', (_req: Request, res: Response) => {
  const data = loadGameData();
  res.json({ entities: data.entities, affixes: data.affixes, version: data.version });
});

// ---- 战斗池 ----

// POST /api/data/battle-pool — 上传 BD
router.post('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const { floor, round, bd_json, power_score } = req.body;
  if (!floor || !round || !bd_json) {
    res.status(400).json({ error: '缺少参数' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO battle_pool (user_id, username, floor, round, bd_json, power_score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.userId!, req.username!, floor, round, JSON.stringify(bd_json), power_score || 0);

  res.json({ id: result.lastInsertRowid });
});

// GET /api/data/battle-pool?floor=1&round=2 — 获取对战池
router.get('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const floor = parseInt(req.query.floor as string, 10);
  const round = parseInt(req.query.round as string, 10);

  const opponents = db.prepare(`
    SELECT id, username, floor, round, bd_json, power_score
    FROM battle_pool
    WHERE floor = ? AND round = ? AND user_id != ?
    ORDER BY power_score DESC
    LIMIT 10
  `).all(floor, round, req.userId!) as any[];

  res.json({ opponents: opponents.map(o => ({ ...o, bd_json: JSON.parse(o.bd_json) })) });
});

export default router;
