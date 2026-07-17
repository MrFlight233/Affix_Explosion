import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/schema';
import { CONFIG } from '../config';

const router = Router();

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }

  if (typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 20) {
    res.status(400).json({ error: '用户名长度 2~20 个字符' });
    return;
  }

  if (typeof password !== 'string' || password.length < 4) {
    res.status(400).json({ error: '密码至少 4 个字符' });
    return;
  }

  const trimmed = username.trim();

  // 检查是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmed);
  if (existing) {
    res.status(409).json({ error: '用户名已存在' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(trimmed, hash);
  const userId = result.lastInsertRowid as number;

  const token = jwt.sign({ userId, username: trimmed }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.JWT_EXPIRES_IN,
  });

  res.status(201).json({ token, user: { id: userId, username: trimmed } });
});

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }

  const user = db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(username.trim()) as any;
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.JWT_EXPIRES_IN,
  });

  res.json({ token, user: { id: user.id, username: user.username } });
});

export default router;
