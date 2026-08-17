/**
 * CLI：从本地 game.db 发布模板种子到 data/seed/
 * 用法：npm run seed:publish
 * 发布前确保种子 JSON 中的样板实体（如鼓舞光环）已写入 DB。
 */
import fs from 'fs';
import path from 'path';
import { initDB, closeDB, publishSeed, entityRepo, templateCache } from '../db';
import { getSeedDir } from '../paths';

const SEED_DIR = getSeedDir(__dirname);

function ensureSeedEntity(id: string): void {
  const entitiesPath = path.join(SEED_DIR, 'entities.json');
  if (!fs.existsSync(entitiesPath)) return;
  const list = JSON.parse(fs.readFileSync(entitiesPath, 'utf8')) as any[];
  const def = Array.isArray(list) ? list.find(e => e?.id === id) : null;
  if (!def) {
    console.warn(`[Seed] 种子中无 ${id}，跳过补齐`);
    return;
  }
  const existing = templateCache.getEntity(id);
  if (!existing) {
    entityRepo.create(def);
    console.log(`[Seed] 已补齐缺失实体: ${id}`);
    return;
  }
  // 鼓舞样板：强制与种子一致（清掉旧主动 duration）
  entityRepo.update(id, {
    name: def.name,
    isActive: false,
    staminaCost: 0,
    actionTime: 0,
    damage: 0,
    onHitEffects: [],
    targetCount: null,
    targetCondition: null,
    hasPassiveBonuses: def.hasPassiveBonuses,
    passiveEffects: def.passiveEffects,
    passiveTargetCondition: def.passiveTargetCondition,
    passiveTargetCount: def.passiveTargetCount,
    hpBonus: 0,
    hpRegenerationBonus: 0,
    staminaBonus: 0,
    staminaRegenerationBonus: 0,
    loadBonus: 0,
  });
  console.log(`[Seed] 已同步被动样板: ${id}`);
}

async function main() {
  await initDB();
  ensureSeedEntity('inspirational_aura');
  const result = publishSeed();
  console.log(JSON.stringify(result, null, 2));
  closeDB();
}

main().catch((e) => {
  console.error('[Seed] 发布失败:', e);
  process.exit(1);
});
