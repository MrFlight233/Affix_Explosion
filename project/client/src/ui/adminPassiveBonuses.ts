// Admin 被动通道：总开关 + 打谁 + 效果库引用（EffectPicker）

import {
  DEFAULT_PASSIVE_TARGET,
  isRootOnlyPassiveTarget,
  resolvePassiveBonusConfig,
} from '../game/passiveBonusUtil';
import type { TargetCondition } from '../game/data';
import type { EffectBinding } from '@shared/effectDef';
import { renderFilterSectionHtml, sortByOptionsHtml, readFilterCheckboxes } from '../game/targetingUtil';
import {
  renderPopoverSelector,
  bindPopoverSelector,
  getSelected,
} from './admin/popoverSelector';
import {
  bindEffectBindingsEditor,
  readEffectBindingsFromDom,
  renderEffectBindingsEditor,
} from './adminEffectBindings';

let _affixOpts: { id: string; name: string; cat?: string }[] = [];

/** 读回"拥有词条"多选 */
function readAffixMultiSelect(ctrlName: string): string[] {
  return getSelected(ctrlName);
}

/** 合并 has_affix 到 filterBy */
function mergeHasAffixFilterBy(filterBy: string[], selectedAffixIds: string[]): string[] {
  const cleaned = filterBy.filter(f => !f.startsWith('has_affix:'));
  if (selectedAffixIds.length > 0) {
    cleaned.push('has_affix:' + selectedAffixIds.join(','));
  }
  return cleaned;
}

export function renderPassiveBonusesEditor(
  prefix: string,
  raw: {
    hasPassiveBonuses?: boolean;
    passiveEffects?: unknown[];
    passiveTargetCondition?: TargetCondition;
    passiveTargetCount?: number | 'all' | null;
    passiveChannel?: { enabled?: boolean; effectBindings?: EffectBinding[]; targetCondition?: TargetCondition; targetCount?: number | 'all' | null };
    hpBonus?: number;
    hpRegenerationBonus?: number;
    staminaBonus?: number;
    staminaRegenerationBonus?: number;
    loadBonus?: number;
  },
  affixOpts?: { id: string; name: string }[],
): string {
  const cfg = resolvePassiveBonusConfig(raw as any);
  const has = raw.passiveChannel?.enabled ?? cfg.hasPassiveBonuses;
  _affixOpts = affixOpts || [];
  const tc = raw.passiveChannel?.targetCondition ?? cfg.passiveTargetCondition;
  const count = raw.passiveChannel?.targetCount ?? cfg.passiveTargetCount;
  const countVal = count === 'all' ? 'all' : String(count || 1);
  const filterBy = Array.isArray(tc.filterBy) ? tc.filterBy : (tc.filterBy ? [tc.filterBy] : []);
  const bindings = raw.passiveChannel?.effectBindings || [];

  let h = '';
  h += `<div class="admin-field"><label>被动加成模式</label><select id="${prefix}-hasPassiveBonuses"><option value="0"${!has ? ' selected' : ''}>无</option><option value="1"${has ? ' selected' : ''}>有</option></select></div>`;
  h += `<div id="${prefix}-passive-fields" style="${has ? '' : 'display:none'}">`;
  h += `<div class="adm-section-title">被动目标</div>`;
  h += `<div class="admin-field"><label>排序</label><select id="${prefix}-ptc-sortBy">${sortByOptionsHtml(tc.sortBy || 'random', false)}</select></div>`;
  h += `<div class="admin-field"><label>过滤</label>
${renderFilterSectionHtml({ name: prefix + '-ptc-filter', filterBy, affixPopoverId: prefix + '-ptc-has-affix', affixOpts: _affixOpts, hint: '目标可多选（OR）；仅「根实体」=发动者；全不选=空目标' })}
</div>`;
  h += `<div class="admin-field"><label>目标数量</label><select id="${prefix}-ptc-count">
    <option value="1"${countVal === '1' ? ' selected' : ''}>1</option>
    <option value="2"${countVal === '2' ? ' selected' : ''}>2</option>
    <option value="3"${countVal === '3' ? ' selected' : ''}>3</option>
    <option value="all"${countVal === 'all' ? ' selected' : ''}>全部</option>
  </select></div>`;
  if (!isRootOnlyPassiveTarget(tc)) {
    h += `<div class="adm-field-hint">由所在第一层实体维持，其阵亡后失效</div>`;
  }
  h += `<div class="adm-section-title">被动效果（效果库引用）</div>`;
  h += renderEffectBindingsEditor(`${prefix}-passive`, 'passive', bindings);
  h += `</div>`;
  return h;
}

export function readPassiveBonusesFromDom(prefix: string): {
  hasPassiveBonuses: boolean;
  effectBindings: EffectBinding[];
  passiveTargetCondition: TargetCondition;
  passiveTargetCount: number | 'all';
  passiveEffects: [];
  hpBonus: number;
  hpRegenerationBonus: number;
  staminaBonus: number;
  staminaRegenerationBonus: number;
  loadBonus: number;
} {
  const has = (document.getElementById(`${prefix}-hasPassiveBonuses`) as HTMLSelectElement)?.value === '1';
  if (!has) {
    return {
      hasPassiveBonuses: false,
      effectBindings: [],
      passiveEffects: [],
      passiveTargetCondition: { ...DEFAULT_PASSIVE_TARGET, filterBy: ['根实体'] },
      passiveTargetCount: 1,
      hpBonus: 0, hpRegenerationBonus: 0, staminaBonus: 0, staminaRegenerationBonus: 0, loadBonus: 0,
    };
  }
  const sortBy = (document.getElementById(`${prefix}-ptc-sortBy`) as HTMLSelectElement)?.value || 'random';
  const filterBy = mergeHasAffixFilterBy(
    readFilterCheckboxes(`${prefix}-ptc-filter`),
    readAffixMultiSelect(`${prefix}-ptc-has-affix`),
  );
  const countRaw = (document.getElementById(`${prefix}-ptc-count`) as HTMLSelectElement)?.value || '1';
  const targetCount: number | 'all' = countRaw === 'all' ? 'all' : (parseInt(countRaw, 10) || 1);

  return {
    hasPassiveBonuses: true,
    effectBindings: readEffectBindingsFromDom(`${prefix}-passive`),
    passiveEffects: [],
    passiveTargetCondition: { sortBy, filterBy },
    passiveTargetCount: targetCount,
    hpBonus: 0, hpRegenerationBonus: 0, staminaBonus: 0, staminaRegenerationBonus: 0, loadBonus: 0,
  };
}

export function bindPassiveBonusesEditor(prefix: string, _initial?: unknown): void {
  const hasSel = document.getElementById(`${prefix}-hasPassiveBonuses`) as HTMLSelectElement | null;
  const fields = document.getElementById(`${prefix}-passive-fields`);

  const syncHas = () => {
    if (!fields || !hasSel) return;
    fields.style.display = hasSel.value === '1' ? '' : 'none';
  };
  hasSel?.addEventListener('change', syncHas);
  bindPopoverSelector(`${prefix}-ptc-has-affix`, _affixOpts);
  bindEffectBindingsEditor(`${prefix}-passive`);
}
