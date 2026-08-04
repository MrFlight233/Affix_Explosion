/**
 * CLI：从本地 game.db 发布模板种子到 data/seed/
 * 用法：npm run seed:publish
 */
import { initDB, closeDB, publishSeed } from '../db';

async function main() {
  await initDB();
  const result = publishSeed();
  console.log(JSON.stringify(result, null, 2));
  closeDB();
}

main().catch((e) => {
  console.error('[Seed] 发布失败:', e);
  process.exit(1);
});
