// ============================================================
// 悬浮提示（v3：统一 EntityDef 渲染，不区分 actionable/equipment 分支）
// ============================================================

import { getEntityDef, getAffixDef, isStarter, EntityDef, getEntityCategory, getCategoryName } from '../game/data';

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
  const hasPsv = !!(def.damageBonus) || !!(def.hpBonus) || !!(def.hpRegenerationBonus) || !!(def.staminaBonus) || !!(def.staminaRegenerationBonus);

  // 标题行: 名称(左) + 价格(右)
  let html = `<div class="tt-name"><span>${def.name}</span><span class="tt-price">价${def.value}</span></div>`;
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

  // 主动动作
  if (def.isActive) {
    html += '<div class="tt-section">主动动作</div>';
    html += `<div class="tt-row"><span class="tt-label">耗时:</span>${def.actionTime}ms</div>`;
    if (def.damage) html += `<div class="tt-row"><span class="tt-label">伤害:</span>${def.damage}</div>`;
    html += `<div class="tt-row"><span class="tt-label">耐力消耗:</span>${def.staminaCost}</div>`;
    const targetInfo = [def.targetType, def.targetOrder].filter(Boolean).join(' ');
    html += `<div class="tt-row"><span class="tt-label">针对:</span>${targetInfo || '—'}${def.priorityTarget ? ' [优先' + def.priorityTarget + ']' : ''}${def.targetFaction ? ' →' + def.targetFaction : ''}</div>`;
  }

  // 被动加成
  if (hasPsv) {
    html += '<div class="tt-section">被动加成</div>';
    if (def.damageBonus) html += `<div class="tt-row"><span class="tt-label">伤害加成:</span>${def.damageBonus > 0 ? '+' : ''}${def.damageBonus}</div>`;
    if (def.hpBonus) html += `<div class="tt-row"><span class="tt-label">生命加成:</span>${def.hpBonus > 0 ? '+' : ''}${def.hpBonus}</div>`;
    if (def.hpRegenerationBonus) html += `<div class="tt-row"><span class="tt-label">生命恢复:</span>+${def.hpRegenerationBonus}/秒</div>`;
    if (def.staminaBonus) html += `<div class="tt-row"><span class="tt-label">耐力加成:</span>+${def.staminaBonus}</div>`;
    if (def.staminaRegenerationBonus) html += `<div class="tt-row"><span class="tt-label">耐力恢复:</span>+${def.staminaRegenerationBonus}/秒</div>`;
  }

  // 词条
  const hasAffixes = def.poolPrerequisite.length > 0 || def.fixedAffixes.length > 0 || def.dynamicAffixSlots > 0
    || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
  if (hasAffixes) {
    html += '<div class="tt-section">词条</div>';
    if (def.poolPrerequisite.length > 0) {
      html += `<div class="tt-row"><span class="tt-label">前置词条:</span>${def.poolPrerequisite.map(id => { const a = getAffixDef(id); return a ? a.name : id; }).join('、') || '无'}</div>`;
    }
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

  let html = `<div class="tt-name"><span>${def.name}</span><span class="tt-price">价${Math.abs(def.costValue)}</span></div>`;
  html += `<div class="tt-cat">${getCategoryName(def.category)}</div>`;
  html += '<div class="tt-section">效果描述</div>';
  html += `<div class="tt-row"><span class="tt-label">效果:</span>${def.effect}</div>`;
  html += '<div class="tt-section">基本信息</div>';
  html += `<div class="tt-row"><span class="tt-label">数值:</span>${def.value}</div>`;
  html += `<div class="tt-row"><span class="tt-label">槽位消耗:</span>${def.slotCost}</div>`;
  html += `<div class="tt-row"><span class="tt-label">可重复:</span>${def.repeatable ? '是' : '否'}</div>`;
  html += '<div class="tt-section">词条</div>';
  html += `<div class="tt-row"><span class="tt-label">前置词条:</span>${resolvePrereq(def.prerequisite)}</div>`;
  if (def.poolPrerequisite && def.poolPrerequisite.length > 0) {
    html += `<div class="tt-row"><span class="tt-label">池前置:</span>${resolvePrereq(def.poolPrerequisite)}</div>`;
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
