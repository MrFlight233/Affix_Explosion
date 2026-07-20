import express from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { initDB, initTables, seedFromJson, templateCache } from './db';
import authRouter from './routes/auth';
import saveRouter from './routes/save';
import dataRouter from './routes/data';
import adminRouter from './routes/admin';

function main() {
  // 初始化数据库（better-sqlite3，同步调用）
  initDB();

  // 建表
  initTables();

  // 检查是否需要导入种子数据（首次启动 / entities 表为空）
  const db = require('./db/connection').getDB();
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as any;
  if (countRow && countRow.cnt === 0) {
    seedFromJson();
  } else {
    // 已有数据，直接加载缓存
    templateCache.load();
  }

  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // 路由
  app.use('/api/auth', authRouter);
  app.use('/api/saves', saveRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/admin', adminRouter);

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.listen(CONFIG.PORT, () => {
    console.log(`[Server] 词条爆炸服务器已启动: http://localhost:${CONFIG.PORT}`);
    console.log(`[Server] 健康检查: http://localhost:${CONFIG.PORT}/api/health`);
  });
}

main();
