import path from 'path';
import { resolveServerRoot, resolveUnderServerRoot } from './paths';

const serverRoot = resolveServerRoot(__dirname);
const envDb = process.env.DB_PATH;
const dbPath = envDb
  ? resolveUnderServerRoot(envDb, __dirname)
  : path.join(serverRoot, 'data', 'game.db');

export const CONFIG = {
  PORT: 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'affix-explosion-secret-key-change-in-production',
  JWT_EXPIRES_IN: '7d',
  /** SQLite 数据库文件绝对路径（相对 server 根，不随 cwd 漂移） */
  DB_PATH: dbPath,
  /** 服务端包根目录（含 data/seed） */
  SERVER_ROOT: serverRoot,
  /** 管理员用户名白名单 */
  ADMIN_USERS: ['admin'],
};
