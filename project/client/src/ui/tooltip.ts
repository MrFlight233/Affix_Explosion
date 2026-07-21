// ============================================================
// 悬浮提示（v3：统一 EntityDef 渲染，不区分 actionable/equipment 分支）
// ============================================================

import { getEntityDef, getAffixDef, isStarter, EntityDef, getEntityCategory } from '../game/data';

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
  const label = isSt ? '启动端' : def.isActive ? '主动装备' : '被动装备';
  const cat = getEntityCategory(def);

  let html = `<div class="tt-name">${def.name} [${label}-${cat}]</div>`;

  if (isSt) {
    // 启动端
    html += `<div class="tt-row"><span class="tt-label">生命:</span>${def.hp}</div>`;
    html += `<div class="tt-row"><span class="tt-label">耐力:</span>${def.maxStamina} / ${def.staminaRegen}/s</div>`;
    html += `<div class="tt-row"><span class="tt-label">负重:</span>${def.maxLoad}</div>`;
  }

  if (!isSt && def.isActive) {
    // 主动装备
    html += `<div class="tt-row"><span class="tt-label">耗时:</span>${def.actionTime}ms</div>`;
    if (def.damage) html += `<div class="tt-row"><span class="tt-label">伤害:</span>${def.damage}</div>`;
    html += `<div class="tt-row"><span class="tt-label">耐力消耗:</span>${def.staminaCost}</div>`;
    html += `<div class="tt-row"><span class="tt-label">攻击:</span>${def.targetType} ${def.targetOrder}${def.priorityTarget ? ' [优先' + def.priorityTarget + ']' : ''}</div>`;
  }

  if (!isSt && !def.isActive) {
    // 被动装备
    if (def.damage) html += `<div class="tt-row"><span class="tt-label">伤害加成:</span>+${def.damage}</div>`;
    
    if (def.regenBonus) html += `<div class="tt-row"><span class="tt-label">回复加成:</span>+${def.regenBonus}</div>`;
    if (def.hpBonus) html += `<div class="tt-row"><span class="tt-label">生命加成:</span>${def.hpBonus > 0 ? '+' : ''}${def.hpBonus}</div>`;
  }

  // 通用信息
  if (!isSt) html += `<div class="tt-row"><span class="tt-label">重量:</span>${def.weight}</div>`;
  if (def.entitySlots) html += `<div class="tt-row"><span class="tt-label">实体槽位:</span>+${def.entitySlots}</div>`;
  html += `<div class="tt-row"><span class="tt-label">槽位:</span>占${def.slotCost} | 词条槽${def.dynamicAffixSlots}</div>`;
  html += `<div class="tt-row"><span class="tt-label">价值:</span>${def.value}</div>`;
  html += `<div class="tt-row"><span class="tt-label">固定词条:</span>${def.fixedAffixes.join('、') || '无'}</div>`;

  tip.innerHTML = html;
}

function renderAffixTooltip(tip: HTMLElement, def: any) {
  tip.innerHTML = `
    <div class="tt-name">${def.name} [${def.category}]</div>
    <div class="tt-row"><span class="tt-label">效果:</span>${def.effect}</div>
    <div class="tt-row"><span class="tt-label">数值:</span>${def.value}</div>
    <div class="tt-row"><span class="tt-label">价值:</span>${Math.abs(def.costValue)}</div>
    <div class="tt-row"><span class="tt-label">槽位:</span>${def.slotCost}</div>
    <div class="tt-row"><span class="tt-label">可重复:</span>${def.repeatable ? '是' : '否'}</div>
    <div class="tt-row"><span class="tt-label">前置:</span>${def.prerequisite.join('、') || '无'}</div>
  `;
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
