import { CombatUnitRuntime } from '../../game/engine';
import {
  EntityDef, AffixDef, ItemInstance,
  getEntityDef, getAffixDef, isStarter, getEntityCategory, getCategoryName,
  getEffectiveEntitySlots, countUsedSlots, countUsedAffixSlots, getEffectiveValue,
  getItemTradeValue, computeStarterLoad,
} from '../../game/data';
import { formatWeightG, formatWeightBonusG } from './format';
import type { CardSide, CardMode, CollapseState } from './types';
import { formatTargetingSummary } from '../../game/targetingUtil';

function targetingFromWeaponOrDef(
  weapon: { targetFaction?: string; targetCount?: number | 'all'; targetCondition?: any } | null | undefined,
  edef: EntityDef,
  item?: ItemInstance,
): string {
  if (weapon) {
    return formatTargetingSummary({
      targetFaction: weapon.targetFaction,
      sortBy: weapon.targetCondition?.sortBy,
      filterBy: weapon.targetCondition?.filterBy,
      targetCount: weapon.targetCount ?? weapon.targetCondition?.targetCount,
    });
  }
  const tc = (item ? getEffectiveValue(item, 'targetCondition') : null) ?? edef.targetCondition;
  return formatTargetingSummary({
    targetFaction: (item ? getEffectiveValue(item, 'targetFaction') : null) ?? edef.targetFaction,
    sortBy: tc?.sortBy,
    targetOrder: edef.targetOrder,
    priorityTarget: edef.priorityTarget,
    filterBy: tc?.filterBy,
    targetCount: (item ? getEffectiveValue(item, 'targetCount') : null) ?? edef.targetCount ?? tc?.targetCount,
  });
}

/** 检查实体是否有被动加成（受 hasPassiveBonuses 约束；字段含 loadBonus） */
export function hasPassive(def: EntityDef): boolean {
  if (def.hasPassiveBonuses === false) return false;
  return ((def.damageBonus || 0) !== 0)
    || (def.hpBonus || 0) !== 0
    || (def.hpRegenerationBonus || 0) !== 0
    || (def.staminaBonus || 0) !== 0
    || (def.staminaRegenerationBonus || 0) !== 0
    || (def.loadBonus || 0) !== 0;
}

export function hasAffixPassive(def: AffixDef): boolean {
  if (def.hasPassiveBonuses === false) return false;
  return !!(def.damageBonus) || !!(def.hpBonus) || !!(def.hpRegenerationBonus)
    || !!(def.staminaBonus) || !!(def.staminaRegenerationBonus) || !!(def.loadBonus);
}

/** 将词条/实体ID数组解析为中文名称 */
export function resolveNames(ids: string[]): string {
  return ids.map(id => {
    const ad = getAffixDef(id);
    if (ad) return ad.name;
    const ed = getEntityDef(id);
    if (ed) return ed.name;
    return id;
  }).join('、') || '无';
}

function sidePrefix(side: CardSide): string {
  if (side === 'player') return 'p';
  if (side === 'enemy') return 'e';
  return 'w';
}

/** 返回实体一行关键信息（折叠视图用）。battle 模式下包含 cu-* span 以支持实时更新 */
export function renderCardKeyInfo(
  item: ItemInstance,
  mode: CardMode,
  combatUnit?: CombatUnitRuntime | null,
  sideFirst?: string,
): string {
  if (item.type === 'affix') {
    const adef = getAffixDef(item.defId);
    if (!adef) return item.defId;
    return `${adef.name}  ${getCategoryName(adef.category)}  槽耗${adef.slotCost}  价${getItemTradeValue(item)}`;
  }

  const edef = getEntityDef(item.defId);
  if (!edef) return item.defId;
  const isSt = isStarter(edef);
  const isActive = edef.isActive;

  if (isSt) {
    const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${edef.hp}/${edef.hp}`;
    const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef.maxStamina}/${edef.maxStamina}`;
    let s: string;
    if (mode === 'battle' && combatUnit && sideFirst) {
      s = `${edef.name}  HP:<span id="cu-hp-${sideFirst}-${item.instanceId}">${hp}</span>  耐力:<span id="cu-sta-${sideFirst}-${item.instanceId}">${stam}</span>`;
    } else {
      s = `${edef.name}  HP:${hp}  耐力:${stam}`;
    }
    if (combatUnit?.isOverloaded) s += '  超重';
    if (combatUnit && combatUnit.currentHp <= 0) s += '  阵亡';

    const effIsActive = edef ? Boolean(getEffectiveValue(item, 'isActive') ?? edef.isActive) : false;
    if (effIsActive && edef) {
      let dmg: number, time: string, targeting: string;
      if (mode === 'battle' && combatUnit) {
        const sw = combatUnit.weapons[0];
        if (sw && sw.name === edef.name) {
          dmg = sw.damage;
          time = sideFirst
            ? `倒计时:<span id="cu-cd-${sideFirst}-${combatUnit.instanceId}-0">${(Math.max(sw.remainingTime, 0) / 1000).toFixed(1)}s</span>`
            : `倒计时:${(Math.max(sw.remainingTime, 0) / 1000).toFixed(1)}s`;
          targeting = targetingFromWeaponOrDef(sw, edef, item);
        } else {
          dmg = Number(getEffectiveValue(item, 'damage') ?? 0);
          time = `耗时:${(Number(getEffectiveValue(item, 'actionTime') ?? 0) / 1000).toFixed(1)}s`;
          targeting = targetingFromWeaponOrDef(null, edef, item);
        }
      } else {
        dmg = Number(getEffectiveValue(item, 'damage') ?? 0);
        time = `耗时:${(Number(getEffectiveValue(item, 'actionTime') ?? 0) / 1000).toFixed(1)}s`;
        targeting = targetingFromWeaponOrDef(null, edef, item);
      }
      s += `  伤:${dmg}  ${time}  ${targeting}`;
    }

    return s;
  } else if (isActive) {
    let dmg: number, time: string, targeting: string;
    if (mode === 'battle' && combatUnit) {
      const matched = combatUnit.weapons.find(w => w.name === edef.name);
      if (matched) {
        dmg = matched.damage;
        if (sideFirst) {
          const wIdx = combatUnit.weapons.indexOf(matched);
          time = `倒计时:<span id="cu-cd-${sideFirst}-${combatUnit.instanceId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>`;
        } else {
          time = `倒计时:${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s`;
        }
        targeting = targetingFromWeaponOrDef(matched, edef);
      } else {
        dmg = edef.damage;
        time = `耗时:${(edef.actionTime / 1000).toFixed(1)}s`;
        targeting = targetingFromWeaponOrDef(null, edef);
      }
    } else {
      dmg = edef.damage;
      time = `耗时:${(edef.actionTime / 1000).toFixed(1)}s`;
      targeting = targetingFromWeaponOrDef(null, edef);
    }
    return `${edef.name}  伤:${dmg}  ${time}  ${targeting}`;
  } else {
    const cat = getEntityCategory(edef).join(' / ');
    return `${edef.name}  HP:${edef.hp}  重:${formatWeightG(edef.weight)}  ${cat}`;
  }
}

/** 折叠状态下递归渲染子实体缩进树 */
export function renderCollapsedChildTree(
  item: ItemInstance,
  depth: number,
  side: string,
  mode: CardMode,
  combatUnit?: CombatUnitRuntime | null,
  sideFirst?: string,
): string {
  const edef = getEntityDef(item.defId);
  if (!edef) return '';
  const ml = `margin-left:${Math.min(depth, 5) * 16}px;`;
  let h = `<div class="sb-collapsed-child" style="${ml}">`;
  h += renderCardKeyInfo(item, mode, combatUnit, sideFirst);
  h += '</div>';
  const entityChildren = (item.children || []).filter(c => c.type === 'entity');
  for (const child of entityChildren) {
    h += renderCollapsedChildTree(child, depth + 1, side, mode, combatUnit, sideFirst);
  }
  return h;
}

export function renderEntityCard(
  item: ItemInstance,
  depth: number,
  side: CardSide,
  mode: CardMode,
  collapse: CollapseState,
  combatUnit?: CombatUnitRuntime | null,
): string {
  const isEntity = item.type === 'entity';
  const def = isEntity ? getEntityDef(item.defId) : getAffixDef(item.defId) as AffixDef | undefined;
  if (!def) return '';

  const instanceId = item.instanceId;
  const sideFirst = sidePrefix(side);
  const ml = depth > 0 ? `margin-left:${Math.min(depth, 3) * 16}px;` : '';
  const cardCollapsed = collapse.collapsedCards.has(instanceId);
  const affixBlockCollapsed = collapse.collapsedAffixBlocks.has(instanceId);
  const childBlockCollapsed = collapse.collapsedChildBlocks.has(instanceId);
  const isSt = isEntity && isStarter(def as EntityDef);
  const isActive = isEntity && (def as EntityDef).isActive;
  const edef = isEntity ? (def as EntityDef) : null;
  const starterHasActive = isSt && edef ? Boolean(getEffectiveValue(item, 'isActive') ?? edef.isActive) : false;

  const deadClass = (combatUnit && combatUnit.currentHp <= 0) ? ' dead' : '';
  const collapsedClass = cardCollapsed ? ' sb-card-collapsed' : '';
  const sortItemAttr = (mode === 'build' && isEntity)
    ? ` data-sort-item="entity" data-instance="${instanceId}" data-side="${side}"`
    : (mode === 'build' && !isEntity)
      ? ` data-sort-item="affix" data-instance="${instanceId}" data-side="${side}"`
      : '';
  let h = `<div class="sb-card${deadClass}${collapsedClass}" style="${ml}" data-depth="${depth}" data-side="${side}" data-mode="${mode}" data-type="${isEntity ? 'entity' : 'affix'}"${sortItemAttr}>`;

  const dragHandleAttr = mode === 'build'
    ? ` data-drag-handle data-instance="${instanceId}" data-side="${side}" data-kind="${isEntity ? 'entity' : 'affix'}" data-defid="${isEntity ? edef!.id : (def as AffixDef).id}" data-type="${isEntity ? 'entity' : 'affix'}"`
    : '';
  const collapseLabel = cardCollapsed ? '展开' : '收起';
  h += `<div class="sb-card-header" data-cardtoggle="${instanceId}" data-defid="${isEntity ? edef!.id : (def as AffixDef).id}" data-type="${isEntity ? 'entity' : 'affix'}"${dragHandleAttr} style="cursor:pointer;">`;
  h += `<span class="sb-card-header-name">${isEntity ? edef!.name : (def as AffixDef).name}</span>`;
  h += '<span class="sb-card-header-keyinfo sb-card-keyinfo">';
  h += renderCardKeyInfo(item, mode, combatUnit, sideFirst);
  h += '</span>';
  h += ` <span class="sb-card-collapse-btn">${collapseLabel}</span></div>`;

  h += '<div class="sb-card-body-expanded">';

  // ── 独立词条卡（仓库顶层等）──
  if (!isEntity) {
    const adef = def as AffixDef;
    h += '<div class="sb-card-block">';
    h += '<div class="sb-block-title">效果描述</div>';
    h += `<div class="sb-card-stats">${adef.effect || '—'}</div>`;
    h += '</div>';

    if (hasAffixPassive(adef)) {
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">被动加成</div>';
      h += '<div class="sb-card-stats">';
      if (adef.damageBonus) h += `伤害加成: ${adef.damageBonus > 0 ? '+' : ''}${adef.damageBonus}  `;
      if (adef.hpBonus) h += `生命加成: ${adef.hpBonus > 0 ? '+' : ''}${adef.hpBonus}  `;
      if (adef.hpRegenerationBonus) h += `生命恢复: +${adef.hpRegenerationBonus}/s  `;
      if (adef.staminaBonus) h += `耐力加成: +${adef.staminaBonus}  `;
      if (adef.staminaRegenerationBonus) h += `耐力恢复: +${adef.staminaRegenerationBonus}/s  `;
      if (adef.loadBonus) h += `负重加成: ${formatWeightBonusG(adef.loadBonus)}`;
      h += '</div></div>';
    }

    h += '<div class="sb-card-block">';
    h += '<div class="sb-block-title">基本信息</div>';
    h += '<div class="sb-card-stats">';
    h += `分类: ${getCategoryName(adef.category)}  槽耗: ${adef.slotCost}  价值: ${getItemTradeValue(item)}  可重复: ${adef.repeatable ? '是' : '否'}`;
    h += '</div></div>';

    if (adef.prerequisite.length > 0 || adef.poolPrerequisite.length > 0) {
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">前置</div>';
      if (adef.prerequisite.length > 0) {
        h += `<div class="sb-card-stats">前置词条: ${resolveNames(adef.prerequisite)}</div>`;
      }
      if (adef.poolPrerequisite.length > 0) {
        h += `<div class="sb-card-stats">池前置: ${resolveNames(adef.poolPrerequisite)}</div>`;
      }
      h += '</div>';
    }

    if (adef.onHitEffects && adef.onHitEffects.length > 0) {
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">命中效果</div>';
      for (const oh of adef.onHitEffects) {
        const params = Object.entries(oh.params || {}).map(([k, v]) => `${k}:${v}`).join(' ');
        h += `<div class="sb-card-stats">${oh.type}${params ? ` (${params})` : ''}</div>`;
      }
      h += '</div>';
    }

    if (adef.targetingModifier) {
      const tm = adef.targetingModifier;
      const summary = formatTargetingSummary({
        targetFaction: tm.targetFaction,
        sortBy: tm.sortBy,
        targetOrder: tm.targetOrder,
        priorityTarget: tm.priorityTarget,
        filterBy: tm.filterBy,
        targetCount: tm.targetCount,
      });
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">索敌覆写</div>';
      h += `<div class="sb-card-stats">${summary}</div>`;
      h += '</div>';
    }

    h += '</div>'; // body-expanded
    h += '<div class="sb-card-body-collapsed"></div>';
    h += '</div>';
    return h;
  }

  h += '<div class="sb-card-block">';
  h += '<div class="sb-block-title">属性</div>';
  if (isSt) {
    const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${edef!.hp}/${edef!.hp}`;
    const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef!.maxStamina}/${edef!.maxStamina}`;
    const sRegen = combatUnit ? combatUnit.staminaRegen : edef!.staminaRegen;
    const hRegen = combatUnit ? combatUnit.hpRegeneration : (edef!.hpRegen || 0);
    h += '<div class="sb-card-stats">';
    h += `HP: <span id="cu-hp-${sideFirst}-${item.instanceId}">${hp}</span>`;
    h += `  耐力: <span id="cu-sta-${sideFirst}-${item.instanceId}">${stam}</span>`;
    h += `  耐力恢复: ${sRegen}/s`;
    h += `  生命恢复: ${hRegen}/s`;
    h += '</div>';
    h += '<div class="sb-card-stats">';
    {
      const load = computeStarterLoad(item);
      h += `负重: ${formatWeightG(load.current)}/${formatWeightG(load.max)}  槽耗: ${edef!.slotCost}`;
    }
    if (mode === 'build') h += `  价值: ${getItemTradeValue(item)}`;
    h += `<span id="cu-ov-${sideFirst}-${item.instanceId}" style="${combatUnit?.isOverloaded ? '' : 'display:none'}">  超重</span>`;
    h += `<span id="cu-dead-${sideFirst}-${item.instanceId}" style="${combatUnit && combatUnit.currentHp <= 0 ? '' : 'display:none'}">  阵亡</span>`;
    h += '</div>';
  } else if (isEntity && edef) {
    h += '<div class="sb-card-stats">';
    h += `HP: ${edef.hp}  `;
    h += `槽耗: ${edef.slotCost}  重: ${formatWeightG(edef.weight)}`;
    if (mode === 'build') h += `  价值: ${getItemTradeValue(item)}`;
    h += '</div>';
  }
  if (edef && hasPassive(edef)) {
    h += '<div class="sb-card-stats">';
    if (edef.damageBonus) h += `伤害加成: ${edef.damageBonus > 0 ? '+' : ''}${edef.damageBonus}  `;
    if (edef.hpBonus) h += `生命加成: ${edef.hpBonus > 0 ? '+' : ''}${edef.hpBonus}  `;
    if (edef.hpRegenerationBonus) h += `生命恢复: +${edef.hpRegenerationBonus}/s  `;
    if (edef.staminaBonus) h += `耐力加成: +${edef.staminaBonus}  `;
    if (edef.staminaRegenerationBonus) h += `耐力恢复: +${edef.staminaRegenerationBonus}/s  `;
    if (edef.loadBonus) h += `负重加成: ${formatWeightBonusG(edef.loadBonus)}`;
    h += '</div>';
  }
  h += '</div>';

  if ((isActive || starterHasActive) && edef) {
    h += '<div class="sb-card-block">';
    h += '<div class="sb-block-title">主动动作</div>';
    h += '<div class="sb-card-stats">';
    if (mode === 'battle' && combatUnit) {
      const matched = combatUnit.weapons.find(w => w.name === edef.name);
      if (matched) {
        const wIdx = combatUnit.weapons.indexOf(matched);
        h += `伤:${matched.damage}  倒计时:<span id="cu-cd-${sideFirst}-${combatUnit!.instanceId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>  耐耗:${matched.staminaCost}  ${targetingFromWeaponOrDef(matched, edef)}`;
      } else {
        h += `伤:${edef.damage}  耗时:${(edef.actionTime / 1000).toFixed(1)}s  耐耗:${edef.staminaCost}  ${targetingFromWeaponOrDef(null, edef)}`;
      }
    } else {
      h += `伤:${edef.damage}  耗时:${(edef.actionTime / 1000).toFixed(1)}s  耐耗:${edef.staminaCost}  ${targetingFromWeaponOrDef(null, edef)}`;
    }
    h += '</div></div>';
  }

  const dynAffixList = (item.children || []).filter(c => c.type === 'affix');
  const dynAffixCount = dynAffixList.length;
  const usedAffixSlots = countUsedAffixSlots(item);
  const hasAffixBlock = (edef && edef.dynamicAffixSlots > 0) || dynAffixCount > 0 || (edef && edef.fixedAffixes.length > 0)
    || (edef && edef.poolPrerequisite.length > 0)
    || (edef && edef.preloadedDynamicAffixes && edef.preloadedDynamicAffixes.length > 0);
  if (hasAffixBlock) {
    h += '<div class="sb-card-block">';
    const affixSlots = edef ? edef.dynamicAffixSlots : 0;
    h += `<div class="sb-block-title" data-affixblocktoggle="${instanceId}" style="cursor:pointer;">`;
    h += `词条 · ${usedAffixSlots}/${affixSlots} 槽位 <span style="font-weight:400;color:var(--sb-text-muted,inherit);margin-left:2px;">${affixBlockCollapsed ? '展开' : '收起'}</span></div>`;
    h += `<div class="sb-foldable${affixBlockCollapsed ? ' sb-folded' : ''}">`;
    if (edef && edef.poolPrerequisite.length > 0) {
      h += `<div class="sb-card-stats">前置词条: ${resolveNames(edef.poolPrerequisite)}</div>`;
    }
    if (edef && edef.preloadedDynamicAffixes && edef.preloadedDynamicAffixes.length > 0) {
      h += `<div class="sb-card-stats">预装动态词条: ${resolveNames(edef.preloadedDynamicAffixes)}</div>`;
    }
    if (edef && edef.fixedAffixes.length > 0) {
      const fixCollapsed = collapse.collapsedFixedAffixRows.has(instanceId);
      const fnames = edef.fixedAffixes.map(a => getAffixDef(a)?.name || a).join('、');
      h += `<div class="sb-card-stats" data-fixtoggle="${instanceId}" style="cursor:pointer;">`;
      h += `固定词条 (${edef.fixedAffixes.length}) <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${fixCollapsed ? '展开' : '收起'}</span>`;
      if (fixCollapsed) h += ` ${fnames}`;
      h += '</div>';
      if (!fixCollapsed) {
        for (const fa of edef.fixedAffixes) {
          const fd = getAffixDef(fa);
          if (fd) h += `<div class="sb-card-stats" style="margin-left:12px;" data-defid="${fa}" data-type="affix">${fd.name}  效果:${fd.effect}</div>`;
        }
      }
    }
    if (affixSlots > 0) {
      const dynCollapsed = collapse.collapsedDynAffixRows.has(instanceId);
      const dnames = dynAffixCount > 0
        ? dynAffixList.map(c => { const ad = getAffixDef(c.defId); return ad ? ad.name : c.defId; }).join('、')
        : '';
      h += `<div class="sb-card-stats" data-dyntoggle="${instanceId}" style="cursor:pointer;">`;
      h += `动态词条 (${dynAffixCount}条, 已用${usedAffixSlots}槽) <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${dynCollapsed ? '展开' : '收起'}</span>`;
      if (dynCollapsed && dynAffixCount > 0) h += ` ${dnames}`;
      h += '</div>';
      if (!dynCollapsed) {
        if (mode === 'build') {
          h += `<div data-sort-list="affix" data-accept="affix" data-instance="${instanceId}" data-side="${side}">`;
        }
        for (const ac of dynAffixList) {
          const ad = getAffixDef(ac.defId);
          if (ad) {
            const handle = mode === 'build'
              ? ` data-drag-handle data-sort-item="affix" data-instance="${ac.instanceId}" data-defid="${ac.defId}" data-type="affix" data-kind="affix" data-side="${side}"`
              : ` data-instance="${ac.instanceId}" data-defid="${ac.defId}" data-type="affix"`;
            h += `<div class="sb-card-stats" style="margin-left:12px;"${handle}>${ad.name}  槽耗${ad.slotCost}  效果:${ad.effect}</div>`;
          }
        }
        if (mode === 'build') {
          const remaining = Math.max(0, affixSlots - usedAffixSlots);
          for (let i = 0; i < remaining; i++) {
            h += `<div class="sb-empty-slot" data-dropzone="affix" data-instance="${instanceId}" data-side="${side}" style="margin-left:12px;">空槽位, 拖入词条</div>`;
          }
          h += '</div>';
        }
      }
    }
    h += '</div>';
    h += '</div>';
  }

  const effSlots = edef ? getEffectiveEntitySlots(edef) : 0;
  const usedSlots = edef ? countUsedSlots(item) : 0;
  const entityChildren = (item.children || []).filter(c => c.type === 'entity');
  const hasChildBlock = (effSlots > 0) || entityChildren.length > 0;
  if (hasChildBlock) {
    h += '<div class="sb-card-block">';
    h += `<div class="sb-block-title" data-childblocktoggle="${instanceId}" style="cursor:pointer;">`;
    h += `子实体 · ${usedSlots}/${effSlots} 槽位 <span style="font-weight:400;color:var(--sb-text-muted,inherit);margin-left:2px;">${childBlockCollapsed ? '展开' : '收起'}</span></div>`;
    h += `<div class="sb-card-stats sb-foldable-child-preview" style="${childBlockCollapsed ? '' : 'display:none'}">${entityChildren.map(c => (getEntityDef(c.defId) || { name: c.defId }).name).join(', ')}</div>`;
    h += `<div class="sb-foldable${childBlockCollapsed ? ' sb-folded' : ''}">`;
    if (mode === 'build') {
      h += `<div class="sb-child-area" data-sort-list="child" data-accept="entity" data-instance="${instanceId}" data-side="${side}">`;
    } else {
      h += '<div class="sb-child-area">';
    }
    for (const child of entityChildren) {
      h += renderEntityCard(child, depth + 1, side, mode, collapse, combatUnit);
    }
    if (mode === 'build') {
      const remaining = effSlots - usedSlots;
      for (let i = 0; i < remaining; i++) {
        h += `<div class="sb-empty-slot" data-dropzone="child" data-instance="${instanceId}" data-side="${side}" style="margin-left:${Math.min(depth + 1, 3) * 16}px;">空槽位, 拖入实体</div>`;
      }
    }
    h += '</div>';
    h += '</div>';
    h += '</div>';
  }

  h += '</div>';

  h += '<div class="sb-card-body-collapsed">';
  const foldedEntityChildren = (item.children || []).filter(c => c.type === 'entity');
  for (const child of foldedEntityChildren) {
    h += renderCollapsedChildTree(child, depth + 1, side, mode, combatUnit, sideFirst);
  }
  h += '</div>';

  h += '</div>';
  return h;
}
