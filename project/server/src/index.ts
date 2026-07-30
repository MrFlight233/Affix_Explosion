import express from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { initDB } from './db';
import authRouter from './routes/auth';
import saveRouter from './routes/save';
import dataRouter from './routes/data';
import adminRouter from './routes/admin';
import historyRouter from './routes/history';

async function main() {
  // 初始化数据库（建表 + 加载缓存）
  await initDB();

  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // 路由
  app.use('/api/auth', authRouter);
  app.use('/api/saves', saveRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/history', historyRouter);

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
