// ============================================================
// 悬浮提示（v3：统一 EntityDef 渲染，不区分 actionable/equipment 分支）
// ============================================================

import { getEntityDef, getAffixDef, isStarter, EntityDef, getEntityCategory, getCategoryName, getDefPackageTradeValue, getAffixPackageTradeValue } from '../game/data';
import { formatTargetingSummary } from '../game/targetingUtil';
import { migrateLegacyDamageToOnHitEffects } from '../game/hitEffectUtil';
import { formatConfigEffectsBlock } from '../game/activeActionDisplay';
import {
  formatPassiveTargetLine,
  hasDisplayPassive,
  passiveEffectPlainLines,
  passiveRootHint,
  resolvePassiveForDisplay,
} from './passiveBonusDisplay';

let tooltipEl: HTMLElement | null = null;

function ensureTooltip(): HTMLElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip(e: MouseEvent, defId: string, type: 'entity' | 'affix') {
  const tip = ensureTooltip();
  if (type === 'entity') {
    const def = getEntityDef(defId);
    if (!def) return;
    renderEntityTooltip(tip, def);
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    renderAffixTooltip(tip, def);
  }

  tip.style.display = 'block';
  positionTooltip(tip, e);
}

function renderEntityTooltip(tip: HTMLElement, def: EntityDef) {
  const isSt = isStarter(def);
  const cat = getEntityCategory(def).join(' / ');

  // 标题行: 名称(左) + 价格(右)
  let html = `<div class="tt-name"><span>${def.name}</span><span class="tt-price">价${getDefPackageTradeValue(def)}</span></div>`;
  // 分类
  html += `<div class="tt-cat">${cat}</div>`;

  // 基本信息
  html += '<div class="tt-section">基本信息</div>';
  if (isSt) {
    html += `<div class="tt-row"><span class="tt-label">生命:</span>${def.hp}</div>`;
    html += `<div class="tt-row"><span class="tt-label">耐力:</span>${def.maxStamina} / ${def.staminaRegen}/s</div>`;
    html += `<div class="tt-row"><span class="tt-label">生命恢复:</span>${def.hpRegen}/s</div>`;
    html += `<div class="tt-row"><span class="tt-label">负重上限:</span>${def.maxLoad}</div>`;
  }
  html += `<div class="tt-row"><span class="tt-label">槽位消耗:</span>${def.slotCost}</div>`;
  if (!isSt) html += `<div class="tt-row"><span class="tt-label">重量:</span>${def.weight}g</div>`;

  // 主动动作（方向 A：左对齐扁平行，无分节标题；行标签区分）
  if (def.isActive) {
    html += '<div class="tt-section">主动动作</div>';
    html += `<div class="tt-row"><span class="tt-label">耐力:</span>${def.staminaCost}</div>`;
    html += `<div class="tt-row"><span class="tt-label">间隔:</span>${(def.actionTime / 1000).toFixed(1)}s</div>`;
    html += `<div class="tt-row tt-block-gap"><span class="tt-label">主动目标:</span>${formatTargetingSummary({
      targetFaction: def.targetFaction,
      sortBy: def.targetCondition?.sortBy,
      targetOrder: def.targetOrder,
      priorityTarget: def.priorityTarget,
      filterBy: def.targetCondition?.filterBy,
      targetCount: def.targetCount ?? def.targetCondition?.targetCount,
    })}</div>`;
    html += '<div class="tt-row tt-block-gap">主动效果</div>';
    const effects = migrateLegacyDamageToOnHitEffects(def.onHitEffects, Number(def.damage) || 0);
    const lines = formatConfigEffectsBlock(effects);
    if (lines.length === 0) {
      html += `<div class="tt-row">无效果</div>`;
    } else {
      for (const line of lines) {
        html += `<div class="tt-row">${line}</div>`;
      }
    }
  }

  // 被动加成
  if (hasDisplayPassive(def)) {
    const pcfg = resolvePassiveForDisplay(def);
    html += '<div class="tt-section">被动加成</div>';
    html += `<div class="tt-row"><span class="tt-label">被动目标:</span>${formatPassiveTargetLine(pcfg)}</div>`;
    html += '<div class="tt-row tt-block-gap">被动效果</div>';
    for (const line of passiveEffectPlainLines(pcfg)) {
      html += `<div class="tt-row">${line}</div>`;
    }
    const hint = passiveRootHint(pcfg);
    if (hint) html += `<div class="tt-row tt-hint">${hint}</div>`;
  }

  // 词条（不展示池前置）
  const hasAffixes = def.fixedAffixes.length > 0 || def.dynamicAffixSlots > 0
    || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
  if (hasAffixes) {
    html += '<div class="tt-section">词条</div>';
    html += `<div class="tt-row"><span class="tt-label">固定词条:</span>${def.fixedAffixes.map(id => { const a = getAffixDef(id); return a ? a.name : id; }).join('、') || '无'}</div>`;
    html += `<div class="tt-row"><span class="tt-label">动态词条槽位:</span>${def.dynamicAffixSlots}</div>`;
    if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
      html += `<div class="tt-row"><span class="tt-label">预装动态词条:</span>${def.preloadedDynamicAffixes.map(id => { const a = getAffixDef(id); return a ? a.name : id; }).join('、')}</div>`;
    }
  }

  // 子实体
  if (def.entitySlots > 0) {
    html += '<div class="tt-section">子实体</div>';
    html += `<div class="tt-row"><span class="tt-label">实体槽位:</span>${def.entitySlots}</div>`;
  }
  if (def.defaultChildren && def.defaultChildren.length > 0) {
    if (def.entitySlots <= 0) html += '<div class="tt-section">子实体</div>';
    html += `<div class="tt-row"><span class="tt-label">预装子实体:</span>${def.defaultChildren.map(c => { const id = typeof c === 'string' ? c : c.defId; const cd = getEntityDef(id); return cd ? cd.name : id; }).join('、')}</div>`;
  }

  tip.innerHTML = html;
}

function renderAffixTooltip(tip: HTMLElement, def: any) {
  const resolvePrereq = (ids: string[]) => ids.map((id: string) => {
    const ad = getAffixDef(id);
    return ad ? ad.name : id;
  }).join('、') || '无';

  let html = `<div class="tt-name"><span>${def.name}</span><span class="tt-price">价${getAffixPackageTradeValue(def)}</span></div>`;
  html += `<div class="tt-cat">${getCategoryName(def.category)}</div>`;
  html += '<div class="tt-section">效果描述</div>';
  html += `<div class="tt-row"><span class="tt-label">效果:</span>${def.effect}</div>`;

  html += '<div class="tt-section">基本信息</div>';
  html += `<div class="tt-row"><span class="tt-label">槽位消耗:</span>${def.slotCost}</div>`;
  html += `<div class="tt-row"><span class="tt-label">可重复:</span>${def.repeatable ? '是' : '否'}</div>`;
  html += '<div class="tt-section">词条</div>';
  html += `<div class="tt-row"><span class="tt-label">前置词条:</span>${resolvePrereq(def.prerequisite)}</div>`;
  if (def.targetingModifier) {
    const tm = def.targetingModifier;
    html += '<div class="tt-section">主动目标覆写</div>';
    html += `<div class="tt-row"><span class="tt-label">覆写:</span>${formatTargetingSummary({
      targetFaction: tm.targetFaction,
      sortBy: tm.sortBy,
      targetOrder: tm.targetOrder,
      priorityTarget: tm.priorityTarget,
      filterBy: tm.filterBy,
      targetCount: tm.targetCount,
    })}</div>`;
  }
  const ohLines = formatConfigEffectsBlock(def.onHitEffects);
  if (ohLines.length > 0) {
    html += '<div class="tt-section">主动效果</div>';
    for (const line of ohLines) {
      html += `<div class="tt-row"><span class="tt-label"></span>${line}</div>`;
    }
  }
  if (hasDisplayPassive(def)) {
    const pcfg = resolvePassiveForDisplay(def);
    html += '<div class="tt-section">被动加成</div>';
    html += `<div class="tt-row"><span class="tt-label">被动目标:</span>${formatPassiveTargetLine(pcfg)}</div>`;
    html += '<div class="tt-row tt-block-gap">被动效果</div>';
    for (const line of passiveEffectPlainLines(pcfg)) {
      html += `<div class="tt-row">${line}</div>`;
    }
    const hint = passiveRootHint(pcfg);
    if (hint) html += `<div class="tt-row tt-hint">${hint}</div>`;
  }
  tip.innerHTML = html;
}

function positionTooltip(tip: HTMLElement, e: MouseEvent) {
  const gap = 12;
  let left = e.clientX + gap;
  let top = e.clientY + gap;

  const rect = tip.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) {
    left = e.clientX - rect.width - gap;
  }
  if (top + rect.height > window.innerHeight - 10) {
    top = e.clientY - rect.height - gap;
  }

  tip.style.left = Math.max(5, left) + 'px';
  tip.style.top = Math.max(5, top) + 'px';
}

export function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}
