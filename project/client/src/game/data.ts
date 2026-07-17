// ============================================================
// 游戏数据 — 实体和词条定义（本地缓存，后端不可用时使用）
// ============================================================

export interface ActionableEntity {
  kind: 'actionable';
  id: string; name: string; category: string;
  slotCost: number; entitySlots: number;
  hp: number; maxStamina: number; staminaRegen: number; maxLoad: number;
  attackType: string; attackOrder: string; priorityTarget: number | null;
  baseDamage: number; baseArmor: number; baseRegen: number; baseActionTime: number;
  value: number; fixedAffixes: string[]; dynamicAffixSlots: number; poolPrerequisite: string[];
}
export interface EquipmentEntity {
  kind: 'equipment';
  id: string; name: string; category: string;
  slotCost: number; entitySlots: number; weight: number;
  isActive: boolean; staminaCost: number;
  attackType: string | null; attackOrder: string | null; priorityTarget: number | null;
  damageBonus: number; armorBonus: number; regenBonus: number; actionTimeMod: number; hpBonus: number;
  value: number; fixedAffixes: string[]; dynamicAffixSlots: number; poolPrerequisite: string[];
}
export type EntityDef = ActionableEntity | EquipmentEntity;

export interface AffixDef {
  id: string; name: string; category: string;
  value: number; costValue: number; slotCost: number;
  repeatable: boolean; prerequisite: string[]; poolPrerequisite: string[];
  target: string; effect: string;
}

export interface ItemInstance {
  instanceId: string;
  defId: string;
  type: 'entity' | 'affix';
}

export interface DeploySlot {
  entity: ItemInstance;
  children: ItemInstance[];
}

// ---- 实体数据 ----
// attackOrder: '从上往下' | '从下往上' — 兜底搜索方向
// priorityTarget: 1|2|3|null — 优先攻击第几位（null=无优先）
export const ENTITY_DEFS: EntityDef[] = [
  // ===== 可行动实体 =====
  { kind:'actionable',id:'adventurer',name:'冒险者',category:'角色',slotCost:2,entitySlots:2,hp:60,maxStamina:100,staminaRegen:10,maxLoad:30,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:5,baseArmor:0,baseRegen:0,baseActionTime:2000,value:50,fixedAffixes:['actionable'],dynamicAffixSlots:3,poolPrerequisite:[] },
  { kind:'actionable',id:'war_wolf',name:'战狼',category:'随从',slotCost:2,entitySlots:0,hp:35,maxStamina:80,staminaRegen:8,maxLoad:15,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:7,baseArmor:1,baseRegen:0,baseActionTime:2000,value:25,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'actionable',id:'spirit',name:'精灵',category:'随从',slotCost:1,entitySlots:0,hp:22,maxStamina:60,staminaRegen:12,maxLoad:10,attackType:'远程',attackOrder:'从下往上',priorityTarget:null,baseDamage:4,baseArmor:0,baseRegen:0,baseActionTime:2500,value:20,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'skeleton_guard',name:'骷髅卫士',category:'随从',slotCost:1,entitySlots:0,hp:28,maxStamina:50,staminaRegen:5,maxLoad:20,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:4,baseArmor:3,baseRegen:0,baseActionTime:3000,value:12,fixedAffixes:['vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'archer',name:'弓箭手',category:'随从',slotCost:1,entitySlots:0,hp:24,maxStamina:70,staminaRegen:9,maxLoad:12,attackType:'远程',attackOrder:'从下往上',priorityTarget:2,baseDamage:6,baseArmor:0,baseRegen:0,baseActionTime:2200,value:22,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'lesser_spirit',name:'小精灵',category:'随从',slotCost:1,entitySlots:0,hp:15,maxStamina:50,staminaRegen:10,maxLoad:8,attackType:'远程',attackOrder:'从上往下',priorityTarget:null,baseDamage:2,baseArmor:0,baseRegen:0,baseActionTime:2800,value:6,fixedAffixes:['vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'hound',name:'猎犬',category:'随从',slotCost:1,entitySlots:0,hp:25,maxStamina:70,staminaRegen:8,maxLoad:10,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:5,baseArmor:1,baseRegen:0,baseActionTime:1800,value:14,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'skeleton_mage',name:'骷髅法师',category:'随从',slotCost:1,entitySlots:0,hp:20,maxStamina:65,staminaRegen:8,maxLoad:10,attackType:'远程',attackOrder:'从下往上',priorityTarget:3,baseDamage:7,baseArmor:0,baseRegen:1,baseActionTime:2800,value:19,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'gargoyle',name:'石像鬼',category:'随从',slotCost:1,entitySlots:0,hp:38,maxStamina:45,staminaRegen:4,maxLoad:25,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:5,baseArmor:6,baseRegen:0,baseActionTime:3200,value:29,fixedAffixes:['vitality1'],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'actionable',id:'fire_sprite',name:'火焰精灵',category:'随从',slotCost:1,entitySlots:0,hp:24,maxStamina:65,staminaRegen:10,maxLoad:10,attackType:'远程',attackOrder:'从下往上',priorityTarget:null,baseDamage:8,baseArmor:0,baseRegen:1,baseActionTime:2400,value:34,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'actionable',id:'ghost',name:'幽灵',category:'随从',slotCost:1,entitySlots:0,hp:20,maxStamina:80,staminaRegen:12,maxLoad:8,attackType:'远程',attackOrder:'从下往上',priorityTarget:2,baseDamage:9,baseArmor:2,baseRegen:2,baseActionTime:2200,value:39,fixedAffixes:['actionable','vitality1'],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'actionable',id:'drake',name:'小型龙',category:'随从',slotCost:2,entitySlots:0,hp:45,maxStamina:70,staminaRegen:7,maxLoad:20,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,baseDamage:10,baseArmor:4,baseRegen:0,baseActionTime:2200,value:46,fixedAffixes:['actionable','vitality2'],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'actionable',id:'angel',name:'天使',category:'随从',slotCost:2,entitySlots:0,hp:40,maxStamina:90,staminaRegen:10,maxLoad:15,attackType:'远程',attackOrder:'从下往上',priorityTarget:null,baseDamage:11,baseArmor:2,baseRegen:3,baseActionTime:2000,value:56,fixedAffixes:['actionable','vitality2'],dynamicAffixSlots:2,poolPrerequisite:[] },
  // ===== 武器（主动型） =====
  { kind:'equipment',id:'short_sword',name:'短剑',category:'武器',slotCost:1,entitySlots:0,weight:5,isActive:true,staminaCost:15,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:4,armorBonus:0,regenBonus:0,actionTimeMod:-200,hpBonus:0,value:15,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'longbow',name:'长弓',category:'武器',slotCost:1,entitySlots:0,weight:8,isActive:true,staminaCost:22,attackType:'远程',attackOrder:'从下往上',priorityTarget:null,damageBonus:8,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:20,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'staff',name:'法杖',category:'武器',slotCost:1,entitySlots:0,weight:6,isActive:true,staminaCost:28,attackType:'远程',attackOrder:'从下往上',priorityTarget:3,damageBonus:10,armorBonus:0,regenBonus:0,actionTimeMod:500,hpBonus:0,value:25,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:['intelligence'] },
  { kind:'equipment',id:'warhammer',name:'战锤',category:'武器',slotCost:2,entitySlots:0,weight:15,isActive:true,staminaCost:35,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:14,armorBonus:2,regenBonus:0,actionTimeMod:1000,hpBonus:0,value:30,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:['strength'] },
  { kind:'equipment',id:'dagger',name:'匕首',category:'武器',slotCost:1,entitySlots:0,weight:3,isActive:true,staminaCost:8,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:3,armorBonus:0,regenBonus:0,actionTimeMod:-400,hpBonus:0,value:10,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'wooden_club',name:'木棒',category:'武器',slotCost:1,entitySlots:0,weight:4,isActive:true,staminaCost:8,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:2,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:3,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'sling',name:'投石索',category:'武器',slotCost:1,entitySlots:0,weight:2,isActive:true,staminaCost:6,attackType:'远程',attackOrder:'从上往下',priorityTarget:null,damageBonus:2,armorBonus:0,regenBonus:0,actionTimeMod:-100,hpBonus:0,value:5,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'shadow_dagger',name:'暗影匕首',category:'武器',slotCost:1,entitySlots:0,weight:2,isActive:true,staminaCost:6,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:2,armorBonus:0,regenBonus:0,actionTimeMod:-600,hpBonus:0,value:7,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'hand_axe',name:'手斧',category:'武器',slotCost:1,entitySlots:0,weight:6,isActive:true,staminaCost:18,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:6,armorBonus:1,regenBonus:0,actionTimeMod:100,hpBonus:0,value:13,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'hunter_bow',name:'猎人弓',category:'武器',slotCost:1,entitySlots:0,weight:6,isActive:true,staminaCost:18,attackType:'远程',attackOrder:'从下往上',priorityTarget:2,damageBonus:6,armorBonus:0,regenBonus:0,actionTimeMod:-100,hpBonus:0,value:16,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'rapier',name:'细剑',category:'武器',slotCost:1,entitySlots:0,weight:4,isActive:true,staminaCost:12,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:5,armorBonus:0,regenBonus:0,actionTimeMod:-500,hpBonus:0,value:18,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'spear',name:'长矛',category:'武器',slotCost:1,entitySlots:0,weight:7,isActive:true,staminaCost:20,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:7,armorBonus:2,regenBonus:0,actionTimeMod:200,hpBonus:0,value:22,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'crossbow',name:'十字弩',category:'武器',slotCost:1,entitySlots:0,weight:10,isActive:true,staminaCost:25,attackType:'远程',attackOrder:'从下往上',priorityTarget:null,damageBonus:12,armorBonus:1,regenBonus:0,actionTimeMod:800,hpBonus:0,value:28,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'flail',name:'链枷',category:'武器',slotCost:1,entitySlots:0,weight:12,isActive:true,staminaCost:28,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:10,armorBonus:3,regenBonus:0,actionTimeMod:300,hpBonus:0,value:32,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'frost_staff',name:'冰霜法杖',category:'武器',slotCost:1,entitySlots:0,weight:7,isActive:true,staminaCost:30,attackType:'远程',attackOrder:'从下往上',priorityTarget:3,damageBonus:11,armorBonus:0,regenBonus:1,actionTimeMod:400,hpBonus:0,value:38,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'greatsword',name:'双手剑',category:'武器',slotCost:2,entitySlots:0,weight:18,isActive:true,staminaCost:38,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:18,armorBonus:2,regenBonus:0,actionTimeMod:600,hpBonus:0,value:45,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'flame_lance',name:'火焰长枪',category:'武器',slotCost:1,entitySlots:0,weight:10,isActive:true,staminaCost:32,attackType:'近战',attackOrder:'从上往下',priorityTarget:1,damageBonus:13,armorBonus:1,regenBonus:0,actionTimeMod:200,hpBonus:0,value:50,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  // ===== 防具（被动型） =====
  { kind:'equipment',id:'leather_armor',name:'皮甲',category:'防具',slotCost:1,entitySlots:0,weight:4,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:3,regenBonus:0,actionTimeMod:0,hpBonus:10,value:12,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'chainmail',name:'锁子甲',category:'防具',slotCost:1,entitySlots:0,weight:8,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:6,regenBonus:0,actionTimeMod:0,hpBonus:20,value:20,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'shield',name:'盾牌',category:'防具',slotCost:1,entitySlots:0,weight:10,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:5,regenBonus:0,actionTimeMod:0,hpBonus:25,value:18,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'cloth_armor',name:'布甲',category:'防具',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:1,regenBonus:0,actionTimeMod:0,hpBonus:3,value:2,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'bone_shield',name:'骨盾',category:'防具',slotCost:1,entitySlots:0,weight:5,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:2,regenBonus:0,actionTimeMod:0,hpBonus:8,value:6,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'hard_leather',name:'硬皮甲',category:'防具',slotCost:1,entitySlots:0,weight:5,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:3,regenBonus:0,actionTimeMod:0,hpBonus:12,value:9,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'buckler',name:'小圆盾',category:'防具',slotCost:1,entitySlots:0,weight:3,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:2,regenBonus:0,actionTimeMod:-200,hpBonus:5,value:11,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'scale_armor',name:'鳞甲',category:'防具',slotCost:1,entitySlots:0,weight:7,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:5,regenBonus:0,actionTimeMod:0,hpBonus:15,value:14,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'knight_armor',name:'骑士铠',category:'防具',slotCost:1,entitySlots:0,weight:12,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:8,regenBonus:0,actionTimeMod:0,hpBonus:30,value:26,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'magic_cloak',name:'魔法斗篷',category:'防具',slotCost:1,entitySlots:0,weight:2,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:3,regenBonus:2,actionTimeMod:0,hpBonus:10,value:33,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'tower_shield',name:'塔盾',category:'防具',slotCost:2,entitySlots:0,weight:16,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:10,regenBonus:0,actionTimeMod:0,hpBonus:40,value:35,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'plate_armor',name:'板甲',category:'防具',slotCost:1,entitySlots:0,weight:15,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:10,regenBonus:0,actionTimeMod:0,hpBonus:35,value:40,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'dragon_scale',name:'龙鳞甲',category:'防具',slotCost:1,entitySlots:0,weight:10,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:12,regenBonus:0,actionTimeMod:0,hpBonus:45,value:55,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  // ===== 饰品（被动型） =====
  { kind:'equipment',id:'life_ring',name:'生命戒指',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:2,actionTimeMod:0,hpBonus:5,value:15,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'speed_boots',name:'速度之靴',category:'饰品',slotCost:1,entitySlots:0,weight:2,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:-500,hpBonus:0,value:12,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'strength_amulet',name:'力量护符',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:3,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:18,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'copper_ring',name:'铜戒指',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:2,value:1,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'lucky_coin',name:'幸运硬币',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:1,armorBonus:1,regenBonus:0,actionTimeMod:0,hpBonus:0,value:4,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'adventurer_badge',name:'冒险者徽章',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:1,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:3,value:5,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'feather_charm',name:'轻羽护符',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:-250,hpBonus:0,value:8,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'night_vision',name:'夜视镜',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:2,armorBonus:0,regenBonus:0,actionTimeMod:-100,hpBonus:0,value:10,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'vitality_ring',name:'活力戒指',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:1,actionTimeMod:0,hpBonus:10,value:17,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'spell_book',name:'魔法书',category:'饰品',slotCost:1,entitySlots:0,weight:3,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:1,regenBonus:2,actionTimeMod:0,hpBonus:0,value:21,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'regen_ring',name:'再生戒指',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:3,actionTimeMod:0,hpBonus:8,value:24,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'berserker_amulet',name:'狂战士护符',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:5,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:-5,value:27,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'sage_ring',name:'贤者戒指',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:2,armorBonus:2,regenBonus:1,actionTimeMod:0,hpBonus:0,value:31,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'time_watch',name:'时空怀表',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:-800,hpBonus:0,value:36,fixedAffixes:[],dynamicAffixSlots:1,poolPrerequisite:[] },
  { kind:'equipment',id:'strength_belt',name:'力量腰带',category:'饰品',slotCost:1,entitySlots:0,weight:2,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:4,armorBonus:2,regenBonus:0,actionTimeMod:0,hpBonus:10,value:42,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'phoenix_feather',name:'凤凰羽毛',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:3,actionTimeMod:0,hpBonus:20,value:48,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'angel_wings',name:'天使之翼',category:'饰品',slotCost:1,entitySlots:0,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:2,regenBonus:1,actionTimeMod:-600,hpBonus:0,value:53,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  { kind:'equipment',id:'philosopher_stone',name:'贤者之石',category:'饰品',slotCost:1,entitySlots:0,weight:2,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:3,armorBonus:3,regenBonus:2,actionTimeMod:0,hpBonus:10,value:58,fixedAffixes:[],dynamicAffixSlots:2,poolPrerequisite:[] },
  // ===== 容器（被动型） =====
  { kind:'equipment',id:'small_bag',name:'小背包',category:'容器',slotCost:1,entitySlots:1,weight:2,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:8,fixedAffixes:['container1'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'large_bag',name:'大背包',category:'容器',slotCost:2,entitySlots:3,weight:4,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:15,fixedAffixes:['container2'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'treasure_chest',name:'宝箱',category:'容器',slotCost:2,entitySlots:4,weight:8,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:28,fixedAffixes:['container3'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'tiny_pouch',name:'小口袋',category:'容器',slotCost:1,entitySlots:1,weight:1,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:3,fixedAffixes:['container1'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'cloth_bag',name:'布袋',category:'容器',slotCost:1,entitySlots:1,weight:3,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:10,fixedAffixes:['container1'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'medium_bag',name:'中型背包',category:'容器',slotCost:1,entitySlots:2,weight:3,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:18,fixedAffixes:['container2'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'dimensional_bag',name:'次元袋',category:'容器',slotCost:2,entitySlots:1,weight:3,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:37,fixedAffixes:['container3'],dynamicAffixSlots:0,poolPrerequisite:[] },
  { kind:'equipment',id:'magic_satchel',name:'魔法行囊',category:'容器',slotCost:2,entitySlots:1,weight:5,isActive:false,staminaCost:0,attackType:null,attackOrder:null,priorityTarget:null,damageBonus:0,armorBonus:0,regenBonus:0,actionTimeMod:0,hpBonus:0,value:52,fixedAffixes:['container4'],dynamicAffixSlots:0,poolPrerequisite:[] },
];

// ---- 词条数据 ----
export const AFFIX_DEFS: AffixDef[] = [
  { id:'strength',name:'力量',category:'属性',value:2,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'伤害 +2' },
  { id:'agility',name:'敏捷',category:'属性',value:300,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'耗时 -300ms' },
  { id:'intelligence',name:'智力',category:'属性',value:1,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'回复 +1' },
  { id:'vitality_affix',name:'体力',category:'属性',value:15,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'HP +15' },
  { id:'actionable',name:'可行动',category:'行动',value:0,costValue:12,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'通用',effect:'可独立行动' },
  { id:'double_strike',name:'连击',category:'行动',value:25,costValue:15,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'25% 额外攻击' },
  { id:'counter',name:'反击',category:'行动',value:30,costValue:12,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'30% 反击' },
  { id:'first_strike',name:'先攻',category:'行动',value:0,costValue:10,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:['agility'],target:'可行动实体',effect:'必定先手' },
  { id:'sharp',name:'锋利',category:'伤害',value:2,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'装备实体',effect:'无视2护甲' },
  { id:'flame',name:'火焰附加',category:'伤害',value:3,costValue:12,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'装备实体',effect:'+3火伤' },
  { id:'poison',name:'毒素',category:'伤害',value:2,costValue:10,slotCost:1,repeatable:true,prerequisite:[],poolPrerequisite:[],target:'装备实体',effect:'中毒3回合' },
  { id:'grievous',name:'重伤',category:'伤害',value:50,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'装备实体',effect:'降低回复50%' },
  { id:'armor_boost',name:'护甲强化',category:'防御',value:3,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'通用',effect:'护甲+3' },
  { id:'magic_resist',name:'魔法抵抗',category:'防御',value:3,costValue:8,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'减3特殊伤害' },
  { id:'dodge',name:'闪避',category:'防御',value:15,costValue:12,slotCost:1,repeatable:false,prerequisite:['agility'],poolPrerequisite:[],target:'可行动实体',effect:'15%闪避' },
  { id:'stamina_boost',name:'耐力强化',category:'耐力',value:30,costValue:10,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'耐力上限+30' },
  { id:'fast_regen',name:'快速恢复',category:'耐力',value:5,costValue:12,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'恢复+5/秒' },
  { id:'efficiency',name:'节能',category:'耐力',value:25,costValue:12,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'耐力消耗-25%' },
  { id:'load_boost',name:'负重强化',category:'负重',value:15,costValue:10,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'负重上限+15' },
  { id:'lightweight',name:'轻量化',category:'负重',value:30,costValue:10,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'装备实体',effect:'重量-30%' },
  { id:'container1',name:'容器1',category:'容器',value:1,costValue:10,slotCost:0,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'通用',effect:'实体槽位+1' },
  { id:'container2',name:'容器2',category:'容器',value:2,costValue:18,slotCost:0,repeatable:false,prerequisite:['container1'],poolPrerequisite:[],target:'通用',effect:'实体槽位+2' },
  { id:'container3',name:'容器3',category:'容器',value:3,costValue:28,slotCost:0,repeatable:false,prerequisite:['container2'],poolPrerequisite:[],target:'通用',effect:'实体槽位+3' },
  { id:'container4',name:'容器4',category:'容器',value:4,costValue:38,slotCost:0,repeatable:false,prerequisite:['container3'],poolPrerequisite:[],target:'通用',effect:'实体槽位+4' },
  { id:'vitality1',name:'占用活力1',category:'限制',value:1,costValue:-5,slotCost:0,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'消耗1活力' },
  { id:'vitality2',name:'占用活力2',category:'限制',value:2,costValue:-10,slotCost:0,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'消耗2活力' },
  { id:'vitality3',name:'占用活力3',category:'限制',value:3,costValue:-15,slotCost:0,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'消耗3活力' },
  { id:'lifesteal',name:'吸血',category:'特殊',value:20,costValue:15,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'吸血20%' },
  { id:'growth',name:'成长',category:'特殊',value:1,costValue:20,slotCost:1,repeatable:false,prerequisite:['actionable'],poolPrerequisite:[],target:'可行动实体',effect:'每战+1伤害(上限10)' },
  { id:'lucky',name:'幸运',category:'特殊',value:10,costValue:12,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'通用',effect:'稀有度+10%' },
  { id:'thorns',name:'荆棘',category:'特殊',value:3,costValue:10,slotCost:1,repeatable:false,prerequisite:[],poolPrerequisite:[],target:'可行动实体',effect:'反弹3伤害' },
];

// 辅助函数
export function getEntityDef(id: string): EntityDef | undefined {
  return ENTITY_DEFS.find(e => e.id === id);
}
export function getAffixDef(id: string): AffixDef | undefined {
  return AFFIX_DEFS.find(a => a.id === id);
}
export function isActionable(def: EntityDef): def is ActionableEntity {
  return def.kind === 'actionable';
}
export function isEquipment(def: EntityDef): def is EquipmentEntity {
  return def.kind === 'equipment';
}

// 简单 ID 生成
let _idCounter = Date.now();
export function genId(): string {
  return 'i_' + (++_idCounter).toString(36);
}
