export const CONFIG = {
  PORT: 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'affix-explosion-secret-key-change-in-production',
  JWT_EXPIRES_IN: '7d',
  DB_PATH: process.env.DB_PATH || './data/game.db',
};
