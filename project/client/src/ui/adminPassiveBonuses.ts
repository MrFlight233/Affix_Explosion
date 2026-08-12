// Admin 被动加成编辑器（目标 + 效果列表，与主动同构、无消耗）

import {
  DEFAULT_PASSIVE_TARGET,
  PASSIVE_STAT_LABEL,
  type PassiveEffect,
  type PassiveOp,
  type PassiveStat,
  formatPassiveEffectLine,
  isRootOnlyPassiveTarget,
  normalizePassiveEffects,
  resolvePassiveBonusConfig,
} from '../game/passiveBonusUtil';
import type { TargetCondition } from '../game/data';
import type { SubtreeCondition } from '@shared/types';
import { renderFilterSectionHtml, parseHasAffixFromFilterBy, sortByOptionsHtml, readFilterCheckboxes, conditionPreviewPrefix } from '../game/targetingUtil';
import {
  renderPopoverSelector,
  bindPopoverSelector,
  getSelected,
} from './admin/popoverSelector';

const STAT_OPTS: PassiveStat[] = ['maxHp', 'maxStamina', 'maxLoad', 'hpRegen', 'staminaRegen'];

let _affixOpts: { id: string; name: string; cat?: string }[] = [];

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

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
    passiveEffects?: PassiveEffect[];
    passiveTargetCondition?: TargetCondition;
    passiveTargetCount?: number | 'all' | null;
    hpBonus?: number;
    hpRegenerationBonus?: number;
    staminaBonus?: number;
    staminaRegenerationBonus?: number;
    loadBonus?: number;
  },
  affixOpts?: { id: string; name: string }[],
): string {
  const cfg = resolvePassiveBonusConfig(raw as any);
  const has = cfg.hasPassiveBonuses;
  _affixOpts = affixOpts || [];
  const tc = cfg.passiveTargetCondition;
  const count = cfg.passiveTargetCount;
  const countVal = count === 'all' ? 'all' : String(count || 1);
  const filterBy = Array.isArray(tc.filterBy) ? tc.filterBy : (tc.filterBy ? [tc.filterBy] : []);

  let h = '';
  h += `<div class="admin-field"><label>被动加成模式</label><select id="${prefix}-hasPassiveBonuses"><option value="0"${!has ? ' selected' : ''}>无</option><option value="1"${has ? ' selected' : ''}>有</option></select></div>`;
  h += `<div id="${prefix}-passive-fields" style="${has ? '' : 'display:none'}">`;
  h += `<div class="adm-section-title">被动目标</div>`;
  h += `<div class="admin-field"><label>排序</label><select id="${prefix}-ptc-sortBy">${sortByOptionsHtml(tc.sortBy || 'random', false)}</select></div>`;
  h += `<div class="admin-field"><label>过滤</label>
${renderFilterSectionHtml({ name: prefix + '-ptc-filter', filterBy, affixPopoverId: prefix + '-ptc-has-affix', affixOpts: _affixOpts })}
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
  h += `<div class="adm-section-title">被动效果</div>`;
  h += `<div class="admin-onhit-list" id="${prefix}-pe-list">`;
  if (cfg.passiveEffects.length === 0) {
    h += `<div class="adm-field-hint">暂无效果</div>`;
  }
  cfg.passiveEffects.forEach((e, i) => { h += renderPassiveEffectRow(prefix, i, e); });
  h += `</div>`;
  h += `<button type="button" class="btn" id="${prefix}-pe-add">添加效果</button>`;
  h += `</div>`;
  return h;
}

function renderPassiveEffectRow(prefix: string, i: number, e: PassiveEffect): string {
  const statOpts = STAT_OPTS.map(s =>
    `<option value="${s}"${e.stat === s ? ' selected' : ''}>${PASSIVE_STAT_LABEL[s]}</option>`,
  ).join('');
  const cond = e.condition;
  const hasCond = !!cond;
  return `<div class="admin-onhit-row" data-idx="${i}">
    <div class="admin-onhit-toolbar">
      <span class="admin-onhit-preview">预览：${escapeAttr(conditionPreviewPrefix(cond, _affixOpts) + formatPassiveEffectLine(e))}</span>
      <button type="button" class="btn btn-danger ${prefix}-pe-del" data-idx="${i}">删除</button>
    </div>
    <div class="admin-field"><label>展示名称</label><input class="${prefix}-pe-name" value="${escapeAttr(e.displayName || '')}"></div>
    <div class="admin-field"><label>影响数据</label><select class="${prefix}-pe-stat">${statOpts}</select></div>
    <div class="admin-field"><label>方向</label><select class="${prefix}-pe-op">
      <option value="gain"${e.op === 'gain' ? ' selected' : ''}>增加</option>
      <option value="loss"${e.op === 'loss' ? ' selected' : ''}>减少</option>
    </select></div>
    <div class="admin-field"><label>固定值</label><input class="${prefix}-pe-amount" type="number" value="${e.params.amount}"></div>
    ${renderConditionEditor(prefix, i, cond)}
  </div>`;
}

function renderConditionEditor(prefix: string, i: number, cond?: SubtreeCondition): string {
  const hasCond = !!cond;
  const matchIds = cond?.matchIds || [];
  const direction = cond?.max !== undefined ? '<=' : '>=';
  const val = cond?.min !== undefined ? String(cond.min) : cond?.max !== undefined ? String(cond.max) : '1';

  return `<div class="admin-field"><label>触发条件</label><select class="${prefix}-pe-cond-sel" data-idx="${i}">
    <option value="有"${hasCond ? ' selected' : ''}>有</option>
    <option value="无"${!hasCond ? ' selected' : ''}>无</option>
  </select></div>
  <div id="${prefix}-pe-cond-body-${i}" style="${hasCond ? '' : 'display:none'}">
    ${renderPopoverSelector(`${prefix}-pe-cond-ids-${i}`, '需求词条', matchIds, _affixOpts)}
    <div class="admin-field" style="display:flex;gap:4px;align-items:center"><label>条件</label><select class="${prefix}-pe-cond-dir">
      <option value=">=" ${direction === '>=' ? 'selected' : ''}>≥</option>
      <option value="<=" ${direction === '<=' ? 'selected' : ''}>≤</option>
    </select></div>
    <div class="admin-field"><label>数量</label><input class="${prefix}-pe-cond-val" type="number" value="${escapeAttr(val)}" min="0" style="width:80px"></div>
  </div>`;
}

function readConditionFromRow(row: HTMLElement, prefix: string): { condition?: SubtreeCondition } | null {
  const on = (row.querySelector(`.${prefix}-pe-cond-sel`) as HTMLSelectElement)?.value === '有';
  if (!on) return null;

  const matchIds = getSelected(`${prefix}-pe-cond-ids-${row.dataset.idx || 0}`);
  if (matchIds.length === 0) return null;

  const dir = (row.querySelector(`.${prefix}-pe-cond-dir`) as HTMLSelectElement)?.value || ">=";
  const val = parseInt(((row.querySelector(`.${prefix}-pe-cond-val`) as HTMLInputElement)?.value || ""), 10);

  const cond: SubtreeCondition = { matchIds };
  if (!isNaN(val)) {
    if (dir === "<=") cond.max = val;
    else cond.min = val;
  }

  return { condition: cond };
}

export function readPassiveBonusesFromDom(prefix: string): {
  hasPassiveBonuses: boolean;
  passiveEffects: PassiveEffect[];
  passiveTargetCondition: TargetCondition;
  passiveTargetCount: number | 'all';
  // 兼容旧保存字段
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

  const effects: PassiveEffect[] = [];
  document.querySelectorAll(`#${prefix}-pe-list .admin-onhit-row`).forEach(row => {
    const name = ((row.querySelector(`.${prefix}-pe-name`) as HTMLInputElement)?.value || '').trim();
    const stat = (row.querySelector(`.${prefix}-pe-stat`) as HTMLSelectElement)?.value as PassiveStat;
    const op = (row.querySelector(`.${prefix}-pe-op`) as HTMLSelectElement)?.value as PassiveOp;
    const amount = parseFloat((row.querySelector(`.${prefix}-pe-amount`) as HTMLInputElement)?.value || '0') || 0;
    if (!stat || amount === 0) return;
    effects.push({
      displayName: name,
      stat,
      op: op === 'loss' ? 'loss' : 'gain',
      params: { amount: Math.abs(amount) },
      ...(readConditionFromRow(row as HTMLElement, prefix) || {}),
    });
  });

  return {
    hasPassiveBonuses: true,
    passiveEffects: normalizePassiveEffects(effects),
    passiveTargetCondition: { sortBy, filterBy },
    passiveTargetCount: targetCount,
    hpBonus: 0, hpRegenerationBonus: 0, staminaBonus: 0, staminaRegenerationBonus: 0, loadBonus: 0,
  };
}

export function bindPassiveBonusesEditor(prefix: string, initial: Parameters<typeof renderPassiveBonusesEditor>[1]): void {
  let effects = resolvePassiveBonusConfig(initial as any).passiveEffects;
  const listEl = document.getElementById(`${prefix}-pe-list`);
  const hasSel = document.getElementById(`${prefix}-hasPassiveBonuses`) as HTMLSelectElement | null;
  const fields = document.getElementById(`${prefix}-passive-fields`);

  const syncHas = () => {
    if (!fields || !hasSel) return;
    fields.style.display = hasSel.value === '1' ? '' : 'none';
  };
  hasSel?.addEventListener('change', syncHas);
  bindPopoverSelector(`${prefix}-ptc-has-affix`, _affixOpts);

  const refreshCondPreview = (row: HTMLElement, idx: number) => {
    const cur = readPassiveBonusesFromDom(prefix);
    const eff = cur.passiveEffects[idx];
    const previewEl = row.querySelector('.admin-onhit-preview');
    if (previewEl && eff) {
      previewEl.textContent = `预览：${escapeAttr(
        conditionPreviewPrefix(eff.condition, _affixOpts) + formatPassiveEffectLine(eff)
      )}`;
    }
  };

  const rebindConditions = () => {
    if (!listEl) return;
    listEl.querySelectorAll(`.${prefix}-pe-cond-sel`).forEach((sel) => {
      const row = (sel as HTMLElement).closest('.admin-onhit-row') as HTMLElement;
      if (!row) return;
      const idx = parseInt(row.dataset.idx || '0', 10);
      const body = document.getElementById(`${prefix}-pe-cond-body-${idx}`);

      (sel as HTMLSelectElement).addEventListener('change', () => {
        if (body) body.style.display = (sel as HTMLSelectElement).value === '有' ? '' : 'none';
        refreshCondPreview(row, idx);
      });

      row.querySelectorAll(`.${prefix}-pe-cond-dir, .${prefix}-pe-cond-val`).forEach(el => {
        el.addEventListener('input', () => refreshCondPreview(row, idx));
        el.addEventListener('change', () => refreshCondPreview(row, idx));
      });

      const fieldId = `${prefix}-pe-cond-ids-${idx}`;
      if (document.getElementById(fieldId)) {
        bindPopoverSelector(fieldId, _affixOpts, undefined, () => {
          refreshCondPreview(row, idx);
        });
      }
    });
  };

  const rerender = () => {
    if (!listEl) return;
    if (effects.length === 0) {
      listEl.innerHTML = `<div class="adm-field-hint">暂无效果</div>`;
    } else {
      listEl.innerHTML = effects.map((e, i) => renderPassiveEffectRow(prefix, i, e)).join('');
    }
    rebindConditions();
    listEl.querySelectorAll(`.${prefix}-pe-del`).forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '-1', 10);
        if (idx < 0) return;
        const cur = readPassiveBonusesFromDom(prefix);
        effects = cur.passiveEffects;
        effects.splice(idx, 1);
        rerender();
      });
    });
  };

  document.getElementById(`${prefix}-pe-add`)?.addEventListener('click', () => {
    const cur = readPassiveBonusesFromDom(prefix);
    effects = cur.passiveEffects;
    effects.push({
      displayName: '',
      stat: 'maxHp',
      op: 'gain',
      params: { amount: 10 },
    });
    rerender();
  });

  rerender();
}
