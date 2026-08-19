import { initDB as initConn, closeDB } from '../db/connection';
import { initTables, migrateEffectCatalogV11AfterSeed } from '../db/seed';
import { importSeedIfEmpty, publishSeed } from '../db/seedData';
import { templateCache } from '../db/cache';

initConn();
initTables();
importSeedIfEmpty();
migrateEffectCatalogV11AfterSeed();
templateCache.load();

console.log('effects', templateCache.getAllEffects().length);
console.log('entities', templateCache.getAllEntities().length);
const withBind = templateCache.getAllEntities().filter((x: any) => (x.activeChannel?.effectBindings?.length || 0) > 0);
console.log('entities with active bindings', withBind.length);
const withP = templateCache.getAllEntities().filter((x: any) => (x.passiveChannel?.effectBindings?.length || 0) > 0);
console.log('entities with passive bindings', withP.length);
console.log('affix active bind', templateCache.getAllAffixes().filter((x: any) => (x.activeChannel?.effectBindings?.length || 0) > 0).length);
console.log('sample', withBind[0]?.id, JSON.stringify(withBind[0]?.activeChannel?.effectBindings?.slice(0, 2)));
publishSeed();
closeDB();
