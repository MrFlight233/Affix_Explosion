import { CombatUnitRuntime } from '../../game/engine';
import {
  EntityDef, ItemInstance,
  getEntityDef, getAffixDef, isStarter, getEntityCategory,
  getEffectiveEntitySlots, getEffectiveDynamicAffixSlots, countUsedSlots, countUsedAffixSlots, getCategoryName,
  getItemTradeValue, getDefPackageTradeValue, getAffixPackageTradeValue, computeStarterLoad, getEffectiveValue,
} from '../../game/data';
import { formatWeightG } from './format';
import { hasAffixPassive, hasPassive, resolveNames } from './entityCard';
import { formatTargetingSummary } from '../../game/targetingUtil';
import { migrateLegacyDamageToOnHitEffects } from '../../game/hitEffectUtil';
import {
  formatActiveActionCollapseSummary,
  formatConfigEffectsBlock,
} from '../../game/activeActionDisplay';
import {
  formatPassiveCollapseSummary,
  formatPassiveEffectPreviewLine,
  formatPassiveTargetLine,
  getPassiveEffectDisplayRows,
  hasDisplayPassive,
  passiveRootHint,
  resolvePassiveForDisplay,
} from '../passiveBonusDisplay';
import { summarizePassiveModsBySource } from '../../game/battle/passives';
import type { CardSide } from './types';
import { instanceIdFromCollapseKey, parseCollapseKey } from './types';

export type SbInstanceLookup = (instanceId: string, side?: CardSide) => ItemInstance | null;
export type SbCombatUnitLookup = (instanceId: string, side?: CardSide) => CombatUnitRuntime | null | undefined;
export type SbConditionRootsLookup = (instanceId: string, side?: CardSide) => ItemInstance[] | null;

/** 从悬浮触发元素解析裸 instanceId + side */
export function resolveTooltipIdentity(el: HTMLElement): { instanceId: string | null; side?: CardSide } {
  const card = el.closest('.sb-card') as HTMLElement | null;
  const sideFromCard = card?.dataset.side as CardSide | undefined;
  if (el.dataset.instance) {
    return { instanceId: el.dataset.instance, side: sideFromCard };
  }
  if (el.dataset.cardtoggle) {
    const parsed = parseCollapseKey(el.dataset.cardtoggle);
    if (parsed) return { instanceId: parsed.instanceId, side: sideFromCard || parsed.side };
    return { instanceId: instanceIdFromCollapseKey(el.dataset.cardtoggle), side: sideFromCard };
  }
  return { instanceId: null, side: sideFromCard };
}

export function tipkv(k: string, v: string | number): string {
  return `<span class="sb-tip-kv"><span class="sb-tip-key">${k}</span><span class="sb-tip-val">${v}</span></span>`;
}

function tipSection(title: string): string {
  return `<div class="sb-tip-section">${title}</div>`;
}

function tipIndent(depth: number): string {
  return `margin-left:${depth * 12}px;`;
}

/** 递归渲染实例子树（tooltip 用），depth=0 为顶层 */
export function renderTooltipTree(
  item: ItemInstance,
  def: EntityDef,
  depth: number,
  sideFirst?: string,
  combatUnit?: CombatUnitRuntime | null,
  conditionRoots?: ItemInstance[] | null,
): string {
  const isSt = isStarter(def);
  const indent = tipIndent(depth);
  const roots = conditionRoots ?? (depth === 0 ? [item] : null);
  let h = '';

  if (depth === 0) {
    const cat = getEntityCategory(def).join(' / ');
    h += `<div class="sb-tip-cat">${cat}</div>`;

    h += tipSection('属性');
    h += '<div class="sb-tip-rows">';
    if (isSt) {
      const baseHp = Number(getEffectiveValue(item, 'hp') ?? def.hp ?? 0);
      const baseSta = Number(getEffectiveValue(item, 'maxStamina') ?? def.maxStamina ?? 0);
      const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${baseHp}/${baseHp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${baseSta}/${baseSta}`;
      const sRegen = combatUnit ? combatUnit.staminaRegen : Number(getEffectiveValue(item, 'staminaRegen') ?? def.staminaRegen ?? 0);
      const hRegen = combatUnit ? combatUnit.hpRegeneration : Number(getEffectiveValue(item, 'hpRegen') ?? def.hpRegen ?? 0);
      h += `<div class="sb-tip-fixed-row">HP: ${hp}  生命恢复: ${hRegen}/s</div>`;
      h += `<div class="sb-tip-fixed-row">耐力: ${stam}  耐力恢复: ${sRegen}/s</div>`;
      const load = combatUnit
        ? `${formatWeightG(combatUnit.currentLoad)}/${formatWeightG(combatUnit.maxLoad)}`
        : (() => {
          const l = computeStarterLoad(item);
          return `${formatWeightG(l.current)}/${formatWeightG(l.max)}`;
        })();
      const wt = Number(getEffectiveValue(item, 'weight') ?? def.weight ?? 0);
      h += `<div class="sb-tip-fixed-row">负重: ${load}  重量：${formatWeightG(wt)}</div>`;
    }
    h += `<div class="sb-tip-fixed-row">槽耗: ${def.slotCost}`;
    if (!isSt) h += `  重: ${formatWeightG(Number(getEffectiveValue(item, 'weight') ?? def.weight ?? 0))}`;
    h += '</div></div>';

    if (def.isActive) {
      h += tipSection('主动动作');
      let staminaCost = def.staminaCost;
      let actionTime = def.actionTime;
      let remaining: number | undefined;
      const w = combatUnit?.weapons.find(x => x.name === def.name);
      if (w) {
        staminaCost = w.staminaCost;
        actionTime = w.actionTime;
        remaining = Math.max(w.remainingTime, 0);
      }
      const effects = migrateLegacyDamageToOnHitEffects(
        w?.onHitEffects?.length ? w.onHitEffects : def.onHitEffects,
        Number(def.damage) || 0,
      );
      const targeting = formatTargetingSummary({
        targetFaction: w?.targetFaction ?? def.targetFaction,
        sortBy: (w?.targetCondition ?? def.targetCondition)?.sortBy,
        targetOrder: def.targetOrder,
        priorityTarget: def.priorityTarget,
        filterBy: (w?.targetCondition ?? def.targetCondition)?.filterBy,
        targetCount: w?.targetCount ?? def.targetCount ?? (w?.targetCondition ?? def.targetCondition)?.targetCount,
      });
      // 方向 A：左对齐扁平行，不用 tipkv 拉开
      const timeLabel = remaining !== undefined
        ? `倒计时: ${(remaining / 1000).toFixed(1)}s`
        : `动作耗时: ${(actionTime / 1000).toFixed(1)}s`;
      h += `<div class="sb-tip-fixed-row" style="${indent}">耐力消耗: ${staminaCost}  ${timeLabel}</div>`;
      h += `<div class="sb-tip-fixed-row sb-block-gap" style="${indent}">主动目标: ${targeting}</div>`;
      h += `<div class="sb-tip-fixed-row sb-block-gap" style="${indent}">主动效果</div>`;
      const lines = formatConfigEffectsBlock(effects);
      if (lines.length === 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">无效果</div>`;
      } else {
        for (const line of lines) {
          h += `<div class="sb-tip-fixed-row" style="${indent}">${line}</div>`;
        }
      }
    }

    if (hasPassive(def)) {
      const pcfg = resolvePassiveForDisplay(def);
      h += tipSection('被动效果');
      h += `<div class="sb-tip-fixed-row" style="${indent}">被动目标: ${formatPassiveTargetLine(pcfg)}</div>`;
      h += `<div class="sb-tip-fixed-row sb-block-gap" style="${indent}">被动效果</div>`;
      for (const row of getPassiveEffectDisplayRows(pcfg, roots)) {
        h += `<div class="sb-tip-fixed-row${row.active ? '' : ' sb-passive-inactive'}" style="${indent}">${row.text}</div>`;
      }
      const hint = passiveRootHint(pcfg);
      if (hint) h += `<div class="sb-tip-fixed-row" style="${indent}">${hint}</div>`;
    }

    if (combatUnit) {
      const modLines = summarizePassiveModsBySource(combatUnit);
      if (modLines.length > 0) {
        h += tipSection('战斗修饰');
        for (const line of modLines) {
          h += `<div class="sb-tip-fixed-row" style="${indent}">${line}</div>`;
        }
      }
    }

    const dynCap = getEffectiveDynamicAffixSlots(item);
    const hasAffixInfo = def.fixedAffixes.length > 0
      || dynCap > 0
      || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
    if (hasAffixInfo) {
      h += tipSection('词条');
      if (def.fixedAffixes.length > 0) {
        for (const fa of def.fixedAffixes) {
          const fd = getAffixDef(fa);
          h += `<div class="sb-tip-fixed-row" style="${indent}">${fd?.name || fa}  <span class="sb-tip-fixed-effect">${fd?.effect || ''}</span></div>`;
        }
      }
      if (dynCap > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">动态词条槽位: ${dynCap}</div>`;
      }
      if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">预装动态词条: ${resolveNames(def.preloadedDynamicAffixes)}</div>`;
      }
    }
  }

  const affixes = (item.children || []).filter(c => c.type === 'affix');
  const entities = (item.children || []).filter(c => c.type === 'entity');
  const effSlots = getEffectiveEntitySlots(item);
  const usedSlots = countUsedSlots(item);

  if (depth === 0 && affixes.length > 0) {
    const usedAffix = countUsedAffixSlots(item);
    const affixCap = getEffectiveDynamicAffixSlots(item);
    h += tipSection(`已挂载词条 (${usedAffix}/${affixCap} 槽位, ${affixes.length}条)`);
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${tipIndent(1)}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }
  if (depth > 0 && affixes.length > 0) {
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${tipIndent(depth + 1)}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }

  if (entities.length > 0) {
    if (depth === 0) {
      h += tipSection(`子实体 (${usedSlots}/${effSlots} 槽位)`);
    }
    for (const child of entities) {
      const cd = getEntityDef(child.defId);
      if (!cd) continue;
      let row = `<div class="sb-tip-tree-row" style="${tipIndent(depth + 1)}">`;
      row += `<span class="sb-tip-entity-name">${cd.name}</span>`;
      if (isStarter(cd)) {
        row += `  HP:${cd.hp}  耐力:${cd.maxStamina}`;
      }
      if (cd.isActive) {
        const effects = migrateLegacyDamageToOnHitEffects(cd.onHitEffects, Number(cd.damage) || 0);
        row += `  ${formatActiveActionCollapseSummary({
          staminaCost: cd.staminaCost,
          targetingSummary: formatTargetingSummary({
            targetFaction: cd.targetFaction,
            sortBy: cd.targetCondition?.sortBy,
            filterBy: cd.targetCondition?.filterBy,
            targetCount: cd.targetCount ?? cd.targetCondition?.targetCount,
          }),
          effects,
        })}`;
      } else if (hasDisplayPassive(cd)) {
        const psum = formatPassiveCollapseSummary(resolvePassiveForDisplay(cd));
        if (psum) row += `  ${psum}`;
      }
      row += `  <span class="sb-tip-muted">槽耗${cd.slotCost}</span>`;
      row += '</div>';
      h += row;
      h += renderTooltipTree(child, cd, depth + 1, sideFirst, null, roots);
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
  getInstance?: SbInstanceLookup,
  getCombatUnit?: SbCombatUnitLookup,
  getConditionRoots?: SbConditionRootsLookup,
  side?: CardSide,
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
      inst = getInstance(instanceId, side);
    }
    const value = inst ? getItemTradeValue(inst) : getDefPackageTradeValue(def);
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${value}</div></div>`;

    const isSt = isStarter(def);
    const renderPoolDef = () => {
      let html = '';
      const cat = getEntityCategory(def).join(' / ');
      html += `<div class="sb-tip-cat">${cat}</div>`;

      html += tipSection('属性');
      html += '<div class="sb-tip-rows">';
      if (isSt) {
        html += `<div class="sb-tip-fixed-row">HP: ${def.hp}/${def.hp}  生命恢复: ${(def.hpRegen || 0)}/s</div>`;
        html += `<div class="sb-tip-fixed-row">耐力: ${def.maxStamina}/${def.maxStamina}  耐力恢复: ${def.staminaRegen}/s</div>`;
        html += `<div class="sb-tip-fixed-row">负重: ${formatWeightG(0)}/${formatWeightG(def.maxLoad)}  重量：${formatWeightG(def.weight)}</div>`;
      }
      html += `<div class="sb-tip-fixed-row">槽耗: ${def.slotCost}`;
      if (!isSt) html += `  重: ${formatWeightG(def.weight)}`;
      html += '</div></div>';

      if (def.isActive) {
        html += tipSection('主动动作');
        const effects = migrateLegacyDamageToOnHitEffects(def.onHitEffects, Number(def.damage) || 0);
        const targeting = formatTargetingSummary({
          targetFaction: def.targetFaction,
          sortBy: def.targetCondition?.sortBy,
          targetOrder: def.targetOrder,
          priorityTarget: def.priorityTarget,
          filterBy: def.targetCondition?.filterBy,
          targetCount: def.targetCount ?? def.targetCondition?.targetCount,
        });
        html += `<div class="sb-tip-fixed-row">耐力消耗: ${def.staminaCost}  动作耗时: ${(def.actionTime / 1000).toFixed(1)}s</div>`;
        html += `<div class="sb-tip-fixed-row sb-block-gap">主动目标: ${targeting}</div>`;
        html += '<div class="sb-tip-fixed-row sb-block-gap">主动效果</div>';
        const lines = formatConfigEffectsBlock(effects);
        if (lines.length === 0) {
          html += '<div class="sb-tip-fixed-row">无效果</div>';
        } else {
          for (const line of lines) {
            html += `<div class="sb-tip-fixed-row">${line}</div>`;
          }
        }
      }

      if (hasPassive(def)) {
        const pcfg = resolvePassiveForDisplay(def);
        html += tipSection('被动效果');
        html += `<div class="sb-tip-fixed-row">被动目标: ${formatPassiveTargetLine(pcfg)}</div>`;
        html += '<div class="sb-tip-fixed-row sb-block-gap">被动效果</div>';
        for (const e of pcfg.passiveEffects) {
          html += `<div class="sb-tip-fixed-row">${formatPassiveEffectPreviewLine(e)}</div>`;
        }
        const hint = passiveRootHint(pcfg);
        if (hint) html += `<div class="sb-tip-fixed-row">${hint}</div>`;
      }

      const hasAffixInfo = def.fixedAffixes.length > 0
        || def.dynamicAffixSlots > 0
        || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
      if (hasAffixInfo) {
        html += tipSection('词条');
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
            const effects = migrateLegacyDamageToOnHitEffects(cd.onHitEffects, Number(cd.damage) || 0);
            row += `  ${formatActiveActionCollapseSummary({
              staminaCost: cd.staminaCost,
              targetingSummary: formatTargetingSummary({
                targetFaction: cd.targetFaction,
                sortBy: cd.targetCondition?.sortBy,
                filterBy: cd.targetCondition?.filterBy,
                targetCount: cd.targetCount ?? cd.targetCondition?.targetCount,
              }),
              effects,
            })}`;
          } else if (hasDisplayPassive(cd)) {
            const psum = formatPassiveCollapseSummary(resolvePassiveForDisplay(cd));
            if (psum) row += `  ${psum}`;
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
      const cu = (instanceId && getCombatUnit) ? getCombatUnit(instanceId, side) : undefined;
      const roots = (instanceId && getConditionRoots)
        ? getConditionRoots(instanceId, side)
        : [inst];
      h += renderTooltipTree(inst, def, 0, undefined, cu, roots);
    } else {
      h += renderPoolDef();
    }
    inner.innerHTML = h;
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${getAffixPackageTradeValue(def)}</div></div>`;
    h += `<div class="sb-tip-cat">${getCategoryName(def.category)}</div>`;
    h += tipSection('效果描述');
    h += `<div class="sb-tip-effect">${def.effect}</div>`;
    h += tipSection('基本信息');
    h += '<div class="sb-tip-grid">';
    h += tipkv('槽位消耗', def.slotCost);
    h += tipkv('可重复', def.repeatable ? '是' : '否');
    h += '</div>';
    if (def.prerequisite.length > 0) {
      h += tipSection('词条');
      h += `<div class="sb-tip-fixed-row">前置词条: ${resolveNames(def.prerequisite)}</div>`;
    }
    if (def.targetingModifier) {
      const tm = def.targetingModifier;
      h += tipSection('主动目标覆写');
      h += `<div class="sb-tip-fixed-row">${formatTargetingSummary({
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
      h += tipSection('主动效果');
      for (const line of ohLines) {
        h += `<div class="sb-tip-fixed-row">${line}</div>`;
      }
    }
    if (hasAffixPassive(def)) {
      const pcfg = resolvePassiveForDisplay(def);
      h += tipSection('被动效果');
      h += `<div class="sb-tip-fixed-row">被动目标: ${formatPassiveTargetLine(pcfg)}</div>`;
      h += '<div class="sb-tip-fixed-row sb-block-gap">被动效果</div>';
      for (const e of pcfg.passiveEffects) {
        h += `<div class="sb-tip-fixed-row">${formatPassiveEffectPreviewLine(e)}</div>`;
      }
      const hint = passiveRootHint(pcfg);
      if (hint) h += `<div class="sb-tip-fixed-row">${hint}</div>`;
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
  getInstance?: SbInstanceLookup,
  getCombatUnit?: SbCombatUnitLookup,
  getConditionRoots?: SbConditionRootsLookup,
): void {
  root.querySelectorAll('[data-defid]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const defId = htmlEl.dataset.defid!;
    const type = (htmlEl.dataset.type || 'entity') as 'entity' | 'affix';
    htmlEl.addEventListener('mouseenter', (e) => {
      const { instanceId, side } = resolveTooltipIdentity(htmlEl);
      showSimTooltip(e as MouseEvent, defId, type, instanceId, getInstance, getCombatUnit, getConditionRoots, side);
    });
    htmlEl.addEventListener('mouseleave', hideSimTooltip);
  });
}

const delegatedRoots = new WeakSet<HTMLElement>();

/**
 * 在 root 上委托 mouseover/mouseout 到 [data-defid]。
 * 同一 root 只绑一次；getInstance 经 WeakMap 可更新。
 */
const rootGetInstance = new WeakMap<HTMLElement, SbInstanceLookup | undefined>();
const rootGetCombatUnit = new WeakMap<HTMLElement, SbCombatUnitLookup | undefined>();
const rootGetConditionRoots = new WeakMap<HTMLElement, SbConditionRootsLookup | undefined>();

export function bindSbTooltips(
  root: HTMLElement,
  getInstance?: SbInstanceLookup,
  getCombatUnit?: SbCombatUnitLookup,
  getConditionRoots?: SbConditionRootsLookup,
): void {
  rootGetInstance.set(root, getInstance);
  rootGetCombatUnit.set(root, getCombatUnit);
  rootGetConditionRoots.set(root, getConditionRoots);
  if (delegatedRoots.has(root)) return;
  delegatedRoots.add(root);

  root.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest('[data-defid]') as HTMLElement | null;
    if (!t || !root.contains(t)) return;
    const from = e.relatedTarget as Node | null;
    if (from && t.contains(from)) return;
    const defId = t.dataset.defid!;
    const type = (t.dataset.type || 'entity') as 'entity' | 'affix';
    const { instanceId, side } = resolveTooltipIdentity(t);
    showSimTooltip(
      e as MouseEvent,
      defId,
      type,
      instanceId,
      rootGetInstance.get(root),
      rootGetCombatUnit.get(root),
      rootGetConditionRoots.get(root),
      side,
    );
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
