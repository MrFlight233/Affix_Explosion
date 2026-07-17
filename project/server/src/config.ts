export const CONFIG = {
  PORT: 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'affix-explosion-secret-key-change-in-production',
  JWT_EXPIRES_IN: '7d',
  DB_PATH: process.env.DB_PATH || './data/game.db',
  /** 管理员用户名白名单 */
  ADMIN_USERS: ['admin'],
  /** 游戏数据 JSON 文件路径 */
  GAME_DATA_PATH: process.env.GAME_DATA_PATH || './data/game_data.json',
};
