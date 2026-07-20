export const CONFIG = {
  PORT: 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'affix-explosion-secret-key-change-in-production',
  JWT_EXPIRES_IN: '7d',
  /** SQLite 数据库文件路径 */
  DB_PATH: process.env.DB_PATH || './data/game.db',
  /** 管理员用户名白名单 */
  ADMIN_USERS: ['admin'],
  /** 种子数据文件路径（仅首次启动 / reset 时使用） */
  SEED_DATA_PATH: process.env.SEED_DATA_PATH || './data/game_data.json',
};
