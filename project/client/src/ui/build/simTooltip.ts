import { CombatUnitRuntime } from '../../game/engine';
import {
  EntityDef, ItemInstance,
  getEntityDef, getAffixDef, isStarter, getEntityCategory,
  getEffectiveEntitySlots, countUsedSlots, countUsedAffixSlots, getCategoryName,
} from '../../game/data';
import { formatWeightG, formatWeightBonusG } from './format';
import { hasPassive, resolveNames } from './entityCard';

export function tipkv(k: string, v: string | number): string {
  return `<span class="sb-tip-kv"><span class="sb-tip-key">${k}</span><span class="sb-tip-val">${v}</span></span>`;
}

function tipSection(title: string): string {
  return `<div class="sb-tip-section">${title}</div>`;
}

function tipIndent(depth: number): string {
  return `margin-left:${depth * 12}px;`;
}

/** 递归计算实体总值：自身 + 固定词条 + 动态词条 + 子孙实体 */
function computeTotalValue(item: ItemInstance): number {
  const def = getEntityDef(item.defId);
  let total = def?.value || 0;
  if (def) {
    for (const fa of def.fixedAffixes) {
      const ad = getAffixDef(fa);
      if (ad) total += Math.abs(ad.costValue);
    }
  }
  for (const c of (item.children || [])) {
    if (c.type === 'affix') {
      const ad = getAffixDef(c.defId);
      if (ad) total += Math.abs(ad.costValue);
    } else if (c.type === 'entity') {
      total += computeTotalValue(c);
    }
  }
  return total;
}

/** 递归渲染实例子树（tooltip 用），depth=0 为顶层 */
export function renderTooltipTree(
  item: ItemInstance,
  def: EntityDef,
  depth: number,
  sideFirst?: string,
  combatUnit?: CombatUnitRuntime | null,
): string {
  const isSt = isStarter(def);
  const indent = tipIndent(depth);
  let h = '';

  if (depth === 0) {
    const cat = getEntityCategory(def).join(' / ');
    h += `<div class="sb-tip-cat">${cat}</div>`;

    h += tipSection('基本信息');
    h += '<div class="sb-tip-grid">';
    if (isSt) {
      const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${def.hp}/${def.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${def.maxStamina}/${def.maxStamina}`;
      const sRegen = combatUnit ? combatUnit.staminaRegen : def.staminaRegen;
      const hRegen = combatUnit ? combatUnit.hpRegeneration : (def.hpRegen || 0);
      h += tipkv('生命', hp) + tipkv('耐力', stam);
      h += tipkv('耐力恢复', sRegen + '/s') + tipkv('生命恢复', hRegen + '/s');
      h += tipkv('负重上限', formatWeightG(def.maxLoad));
    }
    h += tipkv('槽位消耗', def.slotCost);
    if (!isSt) h += tipkv('重量', formatWeightG(def.weight));
    h += '</div>';

    if (def.isActive) {
      h += tipSection('主动动作');
      h += '<div class="sb-tip-grid">';
      let dmg = def.damage, time = (def.actionTime / 1000).toFixed(1) + 's';
      if (combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === def.name);
        if (matched) { dmg = matched.damage; time = `${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s`; }
      }
      h += tipkv('伤害', dmg) + tipkv('耗时', time);
      h += tipkv('耐耗', def.staminaCost) + tipkv('针对类型', def.targetType || '—');
      if (def.targetOrder) h += tipkv('针对顺序', def.targetOrder);
      if (def.priorityTarget != null) h += tipkv('优先目标', '第' + def.priorityTarget + '位');
      if (def.targetFaction) h += tipkv('针对目标', def.targetFaction);
      const tc = (combatUnit ? combatUnit.weapons.find(w => w.name === def.name)?.targetCondition : null) ?? def.targetCondition;
      if (tc?.sortBy) {
        const sortMap: Record<string, string> = { hp_asc: 'HP最低优先', hp_desc: 'HP最高优先', stamina_asc: '耐力最低优先', random: '随机' };
        h += tipkv('条件排序', sortMap[tc.sortBy] || tc.sortBy);
      }
      if (tc?.filterBy) {
        const fbMap: Record<string, string> = { has_debuff: '有debuff', most_buffs: 'Buff最多', hp_below_50pct: 'HP<50%' };
        h += tipkv('条件过滤', fbMap[tc.filterBy] || tc.filterBy);
      }
      h += '</div>';
    }

    if (hasPassive(def)) {
      h += tipSection('被动加成');
      h += '<div class="sb-tip-grid">';
      if (def.damageBonus) h += tipkv('伤害加成', (def.damageBonus > 0 ? '+' : '') + def.damageBonus);
      if (def.hpBonus) h += tipkv('生命加成', (def.hpBonus > 0 ? '+' : '') + def.hpBonus);
      if (def.hpRegenerationBonus) h += tipkv('生命恢复加成', '+' + def.hpRegenerationBonus + '/s');
      if (def.staminaBonus) h += tipkv('耐力加成', '+' + def.staminaBonus);
      if (def.staminaRegenerationBonus) h += tipkv('耐力恢复加成', '+' + def.staminaRegenerationBonus + '/s');
      if (def.loadBonus) h += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
      h += '</div>';
    }

    const hasAffixInfo = def.poolPrerequisite.length > 0
      || def.fixedAffixes.length > 0
      || def.dynamicAffixSlots > 0
      || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
    if (hasAffixInfo) {
      h += tipSection('词条');
      if (def.poolPrerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">前置词条: ${resolveNames(def.poolPrerequisite)}</div>`;
      }
      if (def.fixedAffixes.length > 0) {
        for (const fa of def.fixedAffixes) {
          const fd = getAffixDef(fa);
          h += `<div class="sb-tip-fixed-row" style="${indent}">${fd?.name || fa}  <span class="sb-tip-fixed-effect">${fd?.effect || ''}</span></div>`;
        }
      }
      if (def.dynamicAffixSlots > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">动态词条槽位: ${def.dynamicAffixSlots}</div>`;
      }
      if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">预装动态词条: ${resolveNames(def.preloadedDynamicAffixes)}</div>`;
      }
    }
  }

  const affixes = (item.children || []).filter(c => c.type === 'affix');
  const entities = (item.children || []).filter(c => c.type === 'entity');
  const effSlots = getEffectiveEntitySlots(def);
  const usedSlots = countUsedSlots(item);

  if (depth === 0 && affixes.length > 0) {
    const usedAffix = countUsedAffixSlots(item);
    h += tipSection(`已挂载词条 (${usedAffix}/${def.dynamicAffixSlots} 槽位, ${affixes.length}条)`);
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${tipIndent(1)}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }
  if (depth > 0 && affixes.length > 0) {
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${indent}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }

  if (entities.length > 0) {
    if (depth === 0) {
      h += tipSection(`子实体 (${usedSlots}/${effSlots} 槽位)`);
    }
    for (const child of entities) {
      const cd = getEntityDef(child.defId);
      if (!cd) continue;
      let row = `<div class="sb-tip-tree-row" style="${depth === 0 ? tipIndent(1) : indent}">`;
      row += `<span class="sb-tip-entity-name">${cd.name}</span>`;
      if (isStarter(cd)) {
        row += `  HP:${cd.hp}  耐力:${cd.maxStamina}`;
      }
      if (cd.isActive) {
        row += `  伤:${cd.damage}  ${(cd.actionTime / 1000).toFixed(1)}s`;
      }
      row += `  <span class="sb-tip-muted">槽耗${cd.slotCost}</span>`;
      row += '</div>';
      h += row;
      h += renderTooltipTree(child, cd, depth + 1, sideFirst, combatUnit);
    }
  }

  return h;
}

let tooltipEl: HTMLElement | null = null;
let tipShowTimer: ReturnType<typeof setTimeout> | null = null;

export function ensureTooltip(): HTMLElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'sb-tooltip';
    tooltipEl.innerHTML = '<div class="sb-tip-inner"></div>';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function disposeSimTooltip(): void {
  if (tipShowTimer) { clearTimeout(tipShowTimer); tipShowTimer = null; }
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

export function showSimTooltip(
  e: MouseEvent,
  defId: string,
  type: 'entity' | 'affix',
  instanceId?: string | null,
  getInstance?: (instanceId: string) => ItemInstance | null,
): void {
  if (tipShowTimer) {
    clearTimeout(tipShowTimer);
    tipShowTimer = null;
  }
  const tip = ensureTooltip();
  const inner = tip.querySelector('.sb-tip-inner')!;

  if (type === 'entity') {
    const def = getEntityDef(defId);
    if (!def) return;
    let inst: ItemInstance | null = null;
    if (instanceId && getInstance) {
      inst = getInstance(instanceId);
    }
    const value = inst ? computeTotalValue(inst) : def.value;
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${value}</div></div>`;

    const isSt = isStarter(def);
    const renderPoolDef = () => {
      let html = '';
      const cat = getEntityCategory(def).join(' / ');
      html += `<div class="sb-tip-cat">${cat}</div>`;

      html += tipSection('基本信息');
      html += '<div class="sb-tip-grid">';
      if (isSt) {
        html += tipkv('生命', def.hp) + tipkv('耐力', def.maxStamina);
        html += tipkv('耐力恢复', def.staminaRegen + '/s') + tipkv('生命恢复', (def.hpRegen || 0) + '/s');
        html += tipkv('负重上限', formatWeightG(def.maxLoad));
      }
      html += tipkv('槽位消耗', def.slotCost);
      if (!isSt) html += tipkv('重量', formatWeightG(def.weight));
      html += '</div>';

      if (def.isActive) {
        html += tipSection('主动动作');
        html += '<div class="sb-tip-grid">';
        html += tipkv('伤害', def.damage) + tipkv('耗时', (def.actionTime / 1000).toFixed(1) + 's');
        html += tipkv('耐耗', def.staminaCost) + tipkv('针对类型', def.targetType || '—');
        if (def.targetOrder) html += tipkv('针对顺序', def.targetOrder);
        if (def.priorityTarget != null) html += tipkv('优先目标', '第' + def.priorityTarget + '位');
        if (def.targetFaction) html += tipkv('针对目标', def.targetFaction);
        if (def.targetCondition?.sortBy) {
          const sortMap: Record<string, string> = { hp_asc: 'HP最低优先', hp_desc: 'HP最高优先', stamina_asc: '耐力最低优先', random: '随机' };
          html += tipkv('条件排序', sortMap[def.targetCondition.sortBy] || def.targetCondition.sortBy);
        }
        if (def.targetCondition?.filterBy) {
          const fbMap: Record<string, string> = { has_debuff: '有debuff', most_buffs: 'Buff最多', hp_below_50pct: 'HP<50%' };
          html += tipkv('条件过滤', fbMap[def.targetCondition.filterBy] || def.targetCondition.filterBy);
        }
        html += '</div>';
      }

      if (hasPassive(def)) {
        html += tipSection('被动加成');
        html += '<div class="sb-tip-grid">';
        if (def.damageBonus) html += tipkv('伤害加成', (def.damageBonus > 0 ? '+' : '') + def.damageBonus);
        if (def.hpBonus) html += tipkv('生命加成', (def.hpBonus > 0 ? '+' : '') + def.hpBonus);
        if (def.hpRegenerationBonus) html += tipkv('生命恢复加成', '+' + def.hpRegenerationBonus + '/s');
        if (def.staminaBonus) html += tipkv('耐力加成', '+' + def.staminaBonus);
        if (def.staminaRegenerationBonus) html += tipkv('耐力恢复加成', '+' + def.staminaRegenerationBonus + '/s');
        if (def.loadBonus) html += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
        html += '</div>';
      }

      const hasAffixInfo = def.poolPrerequisite.length > 0
        || def.fixedAffixes.length > 0
        || def.dynamicAffixSlots > 0
        || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
      if (hasAffixInfo) {
        html += tipSection('词条');
        if (def.poolPrerequisite.length > 0) {
          html += `<div class="sb-tip-fixed-row">前置词条: ${resolveNames(def.poolPrerequisite)}</div>`;
        }
        if (def.fixedAffixes.length > 0) {
          for (const fa of def.fixedAffixes) {
            const fd = getAffixDef(fa);
            html += `<div class="sb-tip-fixed-row">${fd?.name || fa}  <span class="sb-tip-fixed-effect">${fd?.effect || ''}</span></div>`;
          }
        }
        if (def.dynamicAffixSlots > 0) {
          html += `<div class="sb-tip-fixed-row">动态词条槽位: ${def.dynamicAffixSlots}</div>`;
        }
        if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
          html += `<div class="sb-tip-fixed-row">预装动态词条: ${resolveNames(def.preloadedDynamicAffixes)}</div>`;
        }
      }

      const defaultKids = def.defaultChildren || [];
      if (defaultKids.length > 0) {
        html += tipSection(`预装子实体 (${defaultKids.length})`);
        for (const kidSpec of defaultKids) {
          const kidId = typeof kidSpec === 'string' ? kidSpec : kidSpec.defId;
          const cd = getEntityDef(kidId);
          if (!cd) continue;
          let row = `<div class="sb-tip-tree-row" style="${tipIndent(1)}"><span class="sb-tip-entity-name">${cd.name}</span>`;
          if (isStarter(cd)) {
            row += `  HP:${cd.hp}  耐力:${cd.maxStamina}`;
          }
          if (cd.isActive) {
            row += `  伤:${cd.damage}  ${(cd.actionTime / 1000).toFixed(1)}s`;
          }
          row += `  <span class="sb-tip-muted">槽耗${cd.slotCost}</span></div>`;
          html += row;
        }
      }

      if (def.entitySlots > 0) {
        if (defaultKids.length === 0) {
          html += tipSection('子实体');
        }
        html += `<div class="sb-tip-fixed-row">实体槽位: ${def.entitySlots}</div>`;
      }
      return html;
    };

    if (inst) {
      const cu: CombatUnitRuntime | null | undefined = undefined;
      h += renderTooltipTree(inst, def, 0, undefined, cu);
    } else {
      h += renderPoolDef();
    }
    inner.innerHTML = h;
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${Math.abs(def.costValue)}</div></div>`;
    h += `<div class="sb-tip-cat">${getCategoryName(def.category)}</div>`;
    h += tipSection('效果描述');
    h += `<div class="sb-tip-effect">${def.effect}</div>`;
    const hasPsv = def.hasPassiveBonuses !== false && (
      !!(def.damageBonus) || !!(def.hpBonus) || !!(def.hpRegenerationBonus)
      || !!(def.staminaBonus) || !!(def.staminaRegenerationBonus) || !!(def.loadBonus)
    );
    if (hasPsv) {
      h += tipSection('被动加成');
      h += '<div class="sb-tip-grid">';
      if (def.damageBonus) h += tipkv('伤害加成', `${def.damageBonus > 0 ? '+' : ''}${def.damageBonus}`);
      if (def.hpBonus) h += tipkv('生命加成', `${def.hpBonus > 0 ? '+' : ''}${def.hpBonus}`);
      if (def.hpRegenerationBonus) h += tipkv('生命恢复', `+${def.hpRegenerationBonus}/秒`);
      if (def.staminaBonus) h += tipkv('耐力加成', `+${def.staminaBonus}`);
      if (def.staminaRegenerationBonus) h += tipkv('耐力恢复', `+${def.staminaRegenerationBonus}/秒`);
      if (def.loadBonus) h += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
      h += '</div>';
    }
    h += tipSection('基本信息');
    h += '<div class="sb-tip-grid">';
    h += tipkv('槽位消耗', def.slotCost);
    h += tipkv('可重复', def.repeatable ? '是' : '否');
    h += '</div>';
    const hasAffixInfo = def.prerequisite.length > 0 || def.poolPrerequisite.length > 0;
    if (hasAffixInfo) {
      h += tipSection('词条');
      if (def.prerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row">前置词条: ${resolveNames(def.prerequisite)}</div>`;
      }
      if (def.poolPrerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row">池前置: ${resolveNames(def.poolPrerequisite)}</div>`;
      }
    }
    inner.innerHTML = h;
  }

  tip.classList.add('sb-tip-visible');
  tip.classList.remove('sb-tip-hiding');
  const gap = 10;
  let left = e.clientX + gap;
  let top = e.clientY + gap;
  tip.style.display = 'block';
  const rect = tip.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) left = e.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - 10) top = e.clientY - rect.height - gap;
  tip.style.left = Math.max(5, left) + 'px';
  tip.style.top = Math.max(5, top) + 'px';
}

export function hideSimTooltip(): void {
  if (tipShowTimer) clearTimeout(tipShowTimer);
  tipShowTimer = setTimeout(() => {
    tipShowTimer = null;
    if (tooltipEl) {
      tooltipEl.classList.add('sb-tip-hiding');
      tooltipEl.classList.remove('sb-tip-visible');
    }
  }, 50);
}

/** 对 root 下每个 [data-defid] 直接绑定 mouseenter/leave */
export function bindTooltipOnRoot(
  root: HTMLElement,
  getInstance?: (instanceId: string) => ItemInstance | null,
): void {
  root.querySelectorAll('[data-defid]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const defId = htmlEl.dataset.defid!;
    const type = (htmlEl.dataset.type || 'entity') as 'entity' | 'affix';
    const instId = htmlEl.dataset.instance || htmlEl.dataset.cardtoggle || null;
    htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type, instId, getInstance));
    htmlEl.addEventListener('mouseleave', hideSimTooltip);
  });
}

const delegatedRoots = new WeakSet<HTMLElement>();

/**
 * 在 root 上委托 mouseover/mouseout 到 [data-defid]。
 * 同一 root 只绑一次；getInstance 经 WeakMap 可更新。
 */
const rootGetInstance = new WeakMap<HTMLElement, ((instanceId: string) => ItemInstance | null) | undefined>();

export function bindSbTooltips(
  root: HTMLElement,
  getInstance?: (instanceId: string) => ItemInstance | null,
): void {
  rootGetInstance.set(root, getInstance);
  if (delegatedRoots.has(root)) return;
  delegatedRoots.add(root);

  root.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest('[data-defid]') as HTMLElement | null;
    if (!t || !root.contains(t)) return;
    const from = e.relatedTarget as Node | null;
    if (from && t.contains(from)) return;
    const defId = t.dataset.defid!;
    const type = (t.dataset.type || 'entity') as 'entity' | 'affix';
    const instId = t.dataset.instance || t.dataset.cardtoggle || null;
    showSimTooltip(e as MouseEvent, defId, type, instId, rootGetInstance.get(root));
  });
  root.addEventListener('mouseout', (e) => {
    const t = (e.target as HTMLElement).closest('[data-defid]') as HTMLElement | null;
    if (!t || !root.contains(t)) return;
    const to = e.relatedTarget as Node | null;
    // 移入同一 [data-defid] 的子节点：不关
    if (to && t.contains(to)) return;
    // relatedTarget 常为 null（进出子节点时）：用落点兜底，仍在同一行则不关
    if (!to) {
      const me = e as MouseEvent;
      const under = document.elementFromPoint(me.clientX, me.clientY) as HTMLElement | null;
      if (under && (t === under || t.contains(under))) return;
    }
    hideSimTooltip();
  });
}
