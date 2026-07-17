// ============================================================
// 悬浮提示
// ============================================================

import { getEntityDef, getAffixDef, isActionable, isEquipment } from '../game/data';

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
    if (isActionable(def)) {
      tip.innerHTML = `
        <div class="tt-name">${def.name} [可行动-${def.category}]</div>
        <div class="tt-row"><span class="tt-label">生命:</span>${def.hp}</div>
        <div class="tt-row"><span class="tt-label">伤害:</span>${def.baseDamage}</div>
        <div class="tt-row"><span class="tt-label">护甲:</span>${def.baseArmor}</div>
        <div class="tt-row"><span class="tt-label">回复:</span>${def.baseRegen}</div>
        <div class="tt-row"><span class="tt-label">耗时:</span>${def.baseActionTime}ms</div>
        <div class="tt-row"><span class="tt-label">耐力:</span>${def.maxStamina} / ${def.staminaRegen}/s</div>
        <div class="tt-row"><span class="tt-label">负重:</span>${def.maxLoad}</div>
        <div class="tt-row"><span class="tt-label">攻击:</span>${def.attackType} ${def.attackOrder}${def.priorityTarget ? ' [优先' + def.priorityTarget + ']' : ''}</div>
        <div class="tt-row"><span class="tt-label">槽位:</span>占${def.slotCost} | 实体槽${def.entitySlots} | 词条槽${def.dynamicAffixSlots}</div>
        <div class="tt-row"><span class="tt-label">价值:</span>${def.value}</div>
        <div class="tt-row"><span class="tt-label">固定词条:</span>${def.fixedAffixes.join('、') || '无'}</div>
      `;
    } else if (isEquipment(def)) {
      tip.innerHTML = `
        <div class="tt-name">${def.name} [${def.isActive ? '主动' : '被动'}-${def.category}]</div>
        ${def.isActive ? `<div class="tt-row"><span class="tt-label">攻击类型:</span>${def.attackType} ${def.attackOrder}${def.priorityTarget ? ' [优先' + def.priorityTarget + ']' : ''}</div>` : ''}
        ${def.isActive ? `<div class="tt-row"><span class="tt-label">耐力消耗:</span>${def.staminaCost}</div>` : ''}
        ${def.damageBonus ? `<div class="tt-row"><span class="tt-label">伤害加成:</span>+${def.damageBonus}</div>` : ''}
        ${def.armorBonus ? `<div class="tt-row"><span class="tt-label">护甲加成:</span>+${def.armorBonus}</div>` : ''}
        ${def.regenBonus ? `<div class="tt-row"><span class="tt-label">回复加成:</span>+${def.regenBonus}</div>` : ''}
        ${def.hpBonus ? `<div class="tt-row"><span class="tt-label">生命加成:</span>+${def.hpBonus}</div>` : ''}
        ${def.actionTimeMod ? `<div class="tt-row"><span class="tt-label">耗时修正:</span>${def.actionTimeMod > 0 ? '+' : ''}${def.actionTimeMod}ms</div>` : ''}
        <div class="tt-row"><span class="tt-label">重量:</span>${def.weight}</div>
        ${def.entitySlots ? `<div class="tt-row"><span class="tt-label">实体槽位:</span>+${def.entitySlots}</div>` : ''}
        <div class="tt-row"><span class="tt-label">槽位:</span>占${def.slotCost} | 词条槽${def.dynamicAffixSlots}</div>
        <div class="tt-row"><span class="tt-label">价值:</span>${def.value}</div>
        <div class="tt-row"><span class="tt-label">固定词条:</span>${def.fixedAffixes.join('、') || '无'}</div>
      `;
    }
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    tip.innerHTML = `
      <div class="tt-name">${def.name} [${def.category}]</div>
      <div class="tt-row"><span class="tt-label">效果:</span>${def.effect}</div>
      <div class="tt-row"><span class="tt-label">数值:</span>${def.value}</div>
      <div class="tt-row"><span class="tt-label">价值:</span>${Math.abs(def.costValue)}</div>
      <div class="tt-row"><span class="tt-label">适用:</span>${def.target}</div>
      <div class="tt-row"><span class="tt-label">槽位:</span>${def.slotCost}</div>
      <div class="tt-row"><span class="tt-label">可重复:</span>${def.repeatable ? '是' : '否'}</div>
      <div class="tt-row"><span class="tt-label">前置:</span>${def.prerequisite.join('、') || '无'}</div>
    `;
  }

  tip.style.display = 'block';
  positionTooltip(tip, e);
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
