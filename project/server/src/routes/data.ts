import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db/schema';

const router = Router();

// ---- 游戏静态数据（从设计文档硬编码） ----
// attackOrder: '从上往下' | '从下往上' — 兜底搜索方向
// priorityTarget: 1|2|3|null — 优先攻击第几位（null=无优先）

const ENTITIES = [
  // ===== 可行动实体 =====
  { id:'adventurer', name:'冒险者', category:'角色', kind:'actionable', slotCost:2, entitySlots:2, hp:60, maxStamina:100, staminaRegen:10, maxLoad:30, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:5, baseArmor:0, baseRegen:0, baseActionTime:2000, value:50, fixedAffixes:['可行动'], dynamicAffixSlots:3, poolPrerequisite:[] },
  { id:'war_wolf', name:'战狼', category:'随从', kind:'actionable', slotCost:2, entitySlots:0, hp:35, maxStamina:80, staminaRegen:8, maxLoad:15, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:7, baseArmor:1, baseRegen:0, baseActionTime:2000, value:25, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'spirit', name:'精灵', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:22, maxStamina:60, staminaRegen:12, maxLoad:10, attackType:'远程', attackOrder:'从下往上', priorityTarget:null, baseDamage:4, baseArmor:0, baseRegen:0, baseActionTime:2500, value:20, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'skeleton_guard', name:'骷髅卫士', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:28, maxStamina:50, staminaRegen:5, maxLoad:20, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:4, baseArmor:3, baseRegen:0, baseActionTime:3000, value:12, fixedAffixes:['占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'archer', name:'弓箭手', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:24, maxStamina:70, staminaRegen:9, maxLoad:12, attackType:'远程', attackOrder:'从下往上', priorityTarget:2, baseDamage:6, baseArmor:0, baseRegen:0, baseActionTime:2200, value:22, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'lesser_spirit', name:'小精灵', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:15, maxStamina:50, staminaRegen:10, maxLoad:8, attackType:'远程', attackOrder:'从上往下', priorityTarget:null, baseDamage:2, baseArmor:0, baseRegen:0, baseActionTime:2800, value:6, fixedAffixes:['占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'hound', name:'猎犬', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:25, maxStamina:70, staminaRegen:8, maxLoad:10, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:5, baseArmor:1, baseRegen:0, baseActionTime:1800, value:14, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'skeleton_mage', name:'骷髅法师', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:20, maxStamina:65, staminaRegen:8, maxLoad:10, attackType:'远程', attackOrder:'从下往上', priorityTarget:3, baseDamage:7, baseArmor:0, baseRegen:1, baseActionTime:2800, value:19, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'gargoyle', name:'石像鬼', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:38, maxStamina:45, staminaRegen:4, maxLoad:25, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:5, baseArmor:6, baseRegen:0, baseActionTime:3200, value:29, fixedAffixes:['占用活力1'], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'fire_sprite', name:'火焰精灵', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:24, maxStamina:65, staminaRegen:10, maxLoad:10, attackType:'远程', attackOrder:'从下往上', priorityTarget:null, baseDamage:8, baseArmor:0, baseRegen:1, baseActionTime:2400, value:34, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'ghost', name:'幽灵', category:'随从', kind:'actionable', slotCost:1, entitySlots:0, hp:20, maxStamina:80, staminaRegen:12, maxLoad:8, attackType:'远程', attackOrder:'从下往上', priorityTarget:2, baseDamage:9, baseArmor:2, baseRegen:2, baseActionTime:2200, value:39, fixedAffixes:['可行动','占用活力1'], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'drake', name:'小型龙', category:'随从', kind:'actionable', slotCost:2, entitySlots:0, hp:45, maxStamina:70, staminaRegen:7, maxLoad:20, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, baseDamage:10, baseArmor:4, baseRegen:0, baseActionTime:2200, value:46, fixedAffixes:['可行动','占用活力2'], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'angel', name:'天使', category:'随从', kind:'actionable', slotCost:2, entitySlots:0, hp:40, maxStamina:90, staminaRegen:10, maxLoad:15, attackType:'远程', attackOrder:'从下往上', priorityTarget:null, baseDamage:11, baseArmor:2, baseRegen:3, baseActionTime:2000, value:56, fixedAffixes:['可行动','占用活力2'], dynamicAffixSlots:2, poolPrerequisite:[] },
  // ===== 武器（主动型） =====
  { id:'short_sword', name:'短剑', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:5, isActive:true, staminaCost:15, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:4, armorBonus:0, regenBonus:0, actionTimeMod:-200, hpBonus:0, value:15, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'longbow', name:'长弓', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:8, isActive:true, staminaCost:22, attackType:'远程', attackOrder:'从下往上', priorityTarget:null, damageBonus:8, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:20, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'staff', name:'法杖', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:6, isActive:true, staminaCost:28, attackType:'远程', attackOrder:'从下往上', priorityTarget:3, damageBonus:10, armorBonus:0, regenBonus:0, actionTimeMod:500, hpBonus:0, value:25, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:['智力'] },
  { id:'warhammer', name:'战锤', category:'武器', kind:'equipment', slotCost:2, entitySlots:0, weight:15, isActive:true, staminaCost:35, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:14, armorBonus:2, regenBonus:0, actionTimeMod:1000, hpBonus:0, value:30, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:['力量'] },
  { id:'dagger', name:'匕首', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:3, isActive:true, staminaCost:8, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:3, armorBonus:0, regenBonus:0, actionTimeMod:-400, hpBonus:0, value:10, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'wooden_club', name:'木棒', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:4, isActive:true, staminaCost:8, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:2, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:3, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'sling', name:'投石索', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:true, staminaCost:6, attackType:'远程', attackOrder:'从上往下', priorityTarget:null, damageBonus:2, armorBonus:0, regenBonus:0, actionTimeMod:-100, hpBonus:0, value:5, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'shadow_dagger', name:'暗影匕首', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:true, staminaCost:6, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:2, armorBonus:0, regenBonus:0, actionTimeMod:-600, hpBonus:0, value:7, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'hand_axe', name:'手斧', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:6, isActive:true, staminaCost:18, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:6, armorBonus:1, regenBonus:0, actionTimeMod:100, hpBonus:0, value:13, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'hunter_bow', name:'猎人弓', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:6, isActive:true, staminaCost:18, attackType:'远程', attackOrder:'从下往上', priorityTarget:2, damageBonus:6, armorBonus:0, regenBonus:0, actionTimeMod:-100, hpBonus:0, value:16, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'rapier', name:'细剑', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:4, isActive:true, staminaCost:12, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:5, armorBonus:0, regenBonus:0, actionTimeMod:-500, hpBonus:0, value:18, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'spear', name:'长矛', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:7, isActive:true, staminaCost:20, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:7, armorBonus:2, regenBonus:0, actionTimeMod:200, hpBonus:0, value:22, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'crossbow', name:'十字弩', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:10, isActive:true, staminaCost:25, attackType:'远程', attackOrder:'从下往上', priorityTarget:null, damageBonus:12, armorBonus:1, regenBonus:0, actionTimeMod:800, hpBonus:0, value:28, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'flail', name:'链枷', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:12, isActive:true, staminaCost:28, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:10, armorBonus:3, regenBonus:0, actionTimeMod:300, hpBonus:0, value:32, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'frost_staff', name:'冰霜法杖', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:7, isActive:true, staminaCost:30, attackType:'远程', attackOrder:'从下往上', priorityTarget:3, damageBonus:11, armorBonus:0, regenBonus:1, actionTimeMod:400, hpBonus:0, value:38, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'greatsword', name:'双手剑', category:'武器', kind:'equipment', slotCost:2, entitySlots:0, weight:18, isActive:true, staminaCost:38, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:18, armorBonus:2, regenBonus:0, actionTimeMod:600, hpBonus:0, value:45, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'flame_lance', name:'火焰长枪', category:'武器', kind:'equipment', slotCost:1, entitySlots:0, weight:10, isActive:true, staminaCost:32, attackType:'近战', attackOrder:'从上往下', priorityTarget:1, damageBonus:13, armorBonus:1, regenBonus:0, actionTimeMod:200, hpBonus:0, value:50, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  // ===== 防具（被动型） =====
  { id:'leather_armor', name:'皮甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:4, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:3, regenBonus:0, actionTimeMod:0, hpBonus:10, value:12, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'chainmail', name:'锁子甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:8, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:6, regenBonus:0, actionTimeMod:0, hpBonus:20, value:20, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'shield', name:'盾牌', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:10, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:5, regenBonus:0, actionTimeMod:0, hpBonus:25, value:18, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'cloth_armor', name:'布甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:1, regenBonus:0, actionTimeMod:0, hpBonus:3, value:2, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'bone_shield', name:'骨盾', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:5, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:2, regenBonus:0, actionTimeMod:0, hpBonus:8, value:6, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'hard_leather', name:'硬皮甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:5, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:3, regenBonus:0, actionTimeMod:0, hpBonus:12, value:9, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'buckler', name:'小圆盾', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:3, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:2, regenBonus:0, actionTimeMod:-200, hpBonus:5, value:11, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'scale_armor', name:'鳞甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:7, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:5, regenBonus:0, actionTimeMod:0, hpBonus:15, value:14, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'knight_armor', name:'骑士铠', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:12, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:8, regenBonus:0, actionTimeMod:0, hpBonus:30, value:26, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'magic_cloak', name:'魔法斗篷', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:3, regenBonus:2, actionTimeMod:0, hpBonus:10, value:33, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'tower_shield', name:'塔盾', category:'防具', kind:'equipment', slotCost:2, entitySlots:0, weight:16, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:10, regenBonus:0, actionTimeMod:0, hpBonus:40, value:35, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'plate_armor', name:'板甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:15, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:10, regenBonus:0, actionTimeMod:0, hpBonus:35, value:40, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'dragon_scale', name:'龙鳞甲', category:'防具', kind:'equipment', slotCost:1, entitySlots:0, weight:10, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:12, regenBonus:0, actionTimeMod:0, hpBonus:45, value:55, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  // ===== 饰品（被动型） =====
  { id:'life_ring', name:'生命戒指', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:2, actionTimeMod:0, hpBonus:5, value:15, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'speed_boots', name:'速度之靴', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:-500, hpBonus:0, value:12, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'strength_amulet', name:'力量护符', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:3, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:18, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'copper_ring', name:'铜戒指', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:2, value:1, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'lucky_coin', name:'幸运硬币', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:1, armorBonus:1, regenBonus:0, actionTimeMod:0, hpBonus:0, value:4, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'adventurer_badge', name:'冒险者徽章', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:1, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:3, value:5, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'feather_charm', name:'轻羽护符', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:-250, hpBonus:0, value:8, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'night_vision', name:'夜视镜', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:2, armorBonus:0, regenBonus:0, actionTimeMod:-100, hpBonus:0, value:10, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'vitality_ring', name:'活力戒指', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:1, actionTimeMod:0, hpBonus:10, value:17, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'spell_book', name:'魔法书', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:3, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:1, regenBonus:2, actionTimeMod:0, hpBonus:0, value:21, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'regen_ring', name:'再生戒指', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:3, actionTimeMod:0, hpBonus:8, value:24, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'berserker_amulet', name:'狂战士护符', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:5, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:-5, value:27, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'sage_ring', name:'贤者戒指', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:2, armorBonus:2, regenBonus:1, actionTimeMod:0, hpBonus:0, value:31, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'time_watch', name:'时空怀表', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:-800, hpBonus:0, value:36, fixedAffixes:[], dynamicAffixSlots:1, poolPrerequisite:[] },
  { id:'strength_belt', name:'力量腰带', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:4, armorBonus:2, regenBonus:0, actionTimeMod:0, hpBonus:10, value:42, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'phoenix_feather', name:'凤凰羽毛', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:3, actionTimeMod:0, hpBonus:20, value:48, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'angel_wings', name:'天使之翼', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:2, regenBonus:1, actionTimeMod:-600, hpBonus:0, value:53, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  { id:'philosopher_stone', name:'贤者之石', category:'饰品', kind:'equipment', slotCost:1, entitySlots:0, weight:2, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:3, armorBonus:3, regenBonus:2, actionTimeMod:0, hpBonus:10, value:58, fixedAffixes:[], dynamicAffixSlots:2, poolPrerequisite:[] },
  // ===== 容器（被动型） =====
  { id:'small_bag', name:'小背包', category:'容器', kind:'equipment', slotCost:1, entitySlots:1, weight:2, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:8, fixedAffixes:['容器1'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'large_bag', name:'大背包', category:'容器', kind:'equipment', slotCost:2, entitySlots:3, weight:4, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:15, fixedAffixes:['容器2'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'treasure_chest', name:'宝箱', category:'容器', kind:'equipment', slotCost:2, entitySlots:4, weight:8, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:28, fixedAffixes:['容器3'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'tiny_pouch', name:'小口袋', category:'容器', kind:'equipment', slotCost:1, entitySlots:1, weight:1, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:3, fixedAffixes:['容器1'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'cloth_bag', name:'布袋', category:'容器', kind:'equipment', slotCost:1, entitySlots:1, weight:3, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:10, fixedAffixes:['容器1'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'medium_bag', name:'中型背包', category:'容器', kind:'equipment', slotCost:1, entitySlots:2, weight:3, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:18, fixedAffixes:['容器2'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'dimensional_bag', name:'次元袋', category:'容器', kind:'equipment', slotCost:2, entitySlots:1, weight:3, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:37, fixedAffixes:['容器3'], dynamicAffixSlots:0, poolPrerequisite:[] },
  { id:'magic_satchel', name:'魔法行囊', category:'容器', kind:'equipment', slotCost:2, entitySlots:1, weight:5, isActive:false, staminaCost:0, attackType:null, attackOrder:null, priorityTarget:null, damageBonus:0, armorBonus:0, regenBonus:0, actionTimeMod:0, hpBonus:0, value:52, fixedAffixes:['容器4'], dynamicAffixSlots:0, poolPrerequisite:[] },
];

const AFFIXES = [
  // 属性
  { id:'strength', name:'力量', category:'属性', value:2, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'伤害 +2' },
  { id:'agility', name:'敏捷', category:'属性', value:300, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'耗时 -300ms' },
  { id:'intelligence', name:'智力', category:'属性', value:1, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'回复 +1' },
  { id:'vitality_affix', name:'体力', category:'属性', value:15, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'HP +15' },
  // 行动
  { id:'actionable', name:'可行动', category:'行动', value:0, costValue:12, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'通用', effect:'可独立行动' },
  { id:'double_strike', name:'连击', category:'行动', value:25, costValue:15, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'25% 额外攻击' },
  { id:'counter', name:'反击', category:'行动', value:30, costValue:12, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'30% 反击' },
  { id:'first_strike', name:'先攻', category:'行动', value:0, costValue:10, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:['敏捷'], target:'可行动实体', effect:'必定先手' },
  // 伤害
  { id:'sharp', name:'锋利', category:'伤害', value:2, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'装备实体', effect:'无视 2 护甲' },
  { id:'flame', name:'火焰附加', category:'伤害', value:3, costValue:12, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'装备实体', effect:'+3 火伤' },
  { id:'poison', name:'毒素', category:'伤害', value:2, costValue:10, slotCost:1, repeatable:true, prerequisite:[], poolPrerequisite:[], target:'装备实体', effect:'中毒 3 回合' },
  { id:'grievous', name:'重伤', category:'伤害', value:50, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'装备实体', effect:'降低回复 50%' },
  // 防御
  { id:'armor_boost', name:'护甲强化', category:'防御', value:3, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'通用', effect:'护甲 +3' },
  { id:'magic_resist', name:'魔法抵抗', category:'防御', value:3, costValue:8, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'减 3 特殊伤害' },
  { id:'dodge', name:'闪避', category:'防御', value:15, costValue:12, slotCost:1, repeatable:false, prerequisite:['敏捷'], poolPrerequisite:[], target:'可行动实体', effect:'15% 闪避' },
  // 耐力
  { id:'stamina_boost', name:'耐力强化', category:'耐力', value:30, costValue:10, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'耐力上限 +30' },
  { id:'fast_regen', name:'快速恢复', category:'耐力', value:5, costValue:12, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'恢复 +5/秒' },
  { id:'efficiency', name:'节能', category:'耐力', value:25, costValue:12, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'耐力消耗 -25%' },
  // 负重
  { id:'load_boost', name:'负重强化', category:'负重', value:15, costValue:10, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'负重上限 +15' },
  { id:'lightweight', name:'轻量化', category:'负重', value:30, costValue:10, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'装备实体', effect:'重量 -30%' },
  // 容器
  { id:'container1', name:'容器1', category:'容器', value:1, costValue:10, slotCost:0, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'通用', effect:'实体槽位 +1' },
  { id:'container2', name:'容器2', category:'容器', value:2, costValue:18, slotCost:0, repeatable:false, prerequisite:['容器1'], poolPrerequisite:[], target:'通用', effect:'实体槽位 +2' },
  { id:'container3', name:'容器3', category:'容器', value:3, costValue:28, slotCost:0, repeatable:false, prerequisite:['容器2'], poolPrerequisite:[], target:'通用', effect:'实体槽位 +3' },
  { id:'container4', name:'容器4', category:'容器', value:4, costValue:38, slotCost:0, repeatable:false, prerequisite:['容器3'], poolPrerequisite:[], target:'通用', effect:'实体槽位 +4' },
  // 限制
  { id:'vitality1', name:'占用活力1', category:'限制', value:1, costValue:-5, slotCost:0, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'消耗 1 活力' },
  { id:'vitality2', name:'占用活力2', category:'限制', value:2, costValue:-10, slotCost:0, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'消耗 2 活力' },
  { id:'vitality3', name:'占用活力3', category:'限制', value:3, costValue:-15, slotCost:0, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'消耗 3 活力' },
  // 特殊
  { id:'lifesteal', name:'吸血', category:'特殊', value:20, costValue:15, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'吸血 20%' },
  { id:'growth', name:'成长', category:'特殊', value:1, costValue:20, slotCost:1, repeatable:false, prerequisite:['可行动'], poolPrerequisite:[], target:'可行动实体', effect:'每战 +1 伤害(上限10)' },
  { id:'lucky', name:'幸运', category:'特殊', value:10, costValue:12, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'通用', effect:'稀有度 +10%' },
  { id:'thorns', name:'荆棘', category:'特殊', value:3, costValue:10, slotCost:1, repeatable:false, prerequisite:[], poolPrerequisite:[], target:'可行动实体', effect:'反弹 3 伤害' },
];

// GET /api/data/entities
router.get('/entities', (_req: Request, res: Response) => {
  res.json({ entities: ENTITIES, version: 1 });
});

// GET /api/data/affixes
router.get('/affixes', (_req: Request, res: Response) => {
  res.json({ affixes: AFFIXES, version: 1 });
});

// GET /api/data/all — 一次性获取所有游戏数据
router.get('/all', (_req: Request, res: Response) => {
  res.json({ entities: ENTITIES, affixes: AFFIXES, version: 1 });
});

// ---- 战斗池 ----

// POST /api/data/battle-pool — 上传 BD
router.post('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const { floor, round, bd_json, power_score } = req.body;
  if (!floor || !round || !bd_json) {
    res.status(400).json({ error: '缺少参数' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO battle_pool (user_id, username, floor, round, bd_json, power_score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.userId!, req.username!, floor, round, JSON.stringify(bd_json), power_score || 0);

  res.json({ id: result.lastInsertRowid });
});

// GET /api/data/battle-pool?floor=1&round=2 — 获取对战池
router.get('/battle-pool', authMiddleware, (req: AuthRequest, res: Response) => {
  const floor = parseInt(req.query.floor as string, 10);
  const round = parseInt(req.query.round as string, 10);

  const opponents = db.prepare(`
    SELECT id, username, floor, round, bd_json, power_score
    FROM battle_pool
    WHERE floor = ? AND round = ? AND user_id != ?
    ORDER BY power_score DESC
    LIMIT 10
  `).all(floor, round, req.userId!) as any[];

  res.json({ opponents: opponents.map(o => ({ ...o, bd_json: JSON.parse(o.bd_json) })) });
});

export default router;
