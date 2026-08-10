// Admin 被动加成编辑器（目标 + 效果列表，与主动同构、无消耗）

import {
  DEFAULT_PASSIVE_TARGET,
  PASSIVE_STAT_LABEL,
  type PassiveEffect,
  type PassiveOp,
  type PassiveStat,
  formatPassiveEffectLine,
  isSelfOnlyPassiveTarget,
  normalizePassiveEffects,
  resolvePassiveBonusConfig,
} from '../game/passiveBonusUtil';
import type { TargetCondition } from '../game/data';
import { filterCheckboxesHtml, sortByOptionsHtml, readFilterCheckboxes } from '../game/targetingUtil';

const STAT_OPTS: PassiveStat[] = ['maxHp', 'maxStamina', 'maxLoad', 'hpRegen', 'staminaRegen'];

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
): string {
  const cfg = resolvePassiveBonusConfig(raw as any);
  const has = cfg.hasPassiveBonuses;
  const tc = cfg.passiveTargetCondition;
  const count = cfg.passiveTargetCount;
  const countVal = count === 'all' ? 'all' : String(count || 1);

  let h = '';
  h += `<div class="admin-field"><label>被动加成模式</label><select id="${prefix}-hasPassiveBonuses"><option value="0"${!has ? ' selected' : ''}>无</option><option value="1"${has ? ' selected' : ''}>有</option></select></div>`;
  h += `<div id="${prefix}-passive-fields" style="${has ? '' : 'display:none'}">`;
  h += `<div class="adm-section-title">被动目标</div>`;
  h += `<div class="admin-field"><label>排序</label><select id="${prefix}-ptc-sortBy">${sortByOptionsHtml(tc.sortBy || 'random', false)}</select></div>`;
  h += `<div class="admin-field"><label>过滤</label><div id="${prefix}-ptc-filter">${filterCheckboxesHtml(prefix + '-ptc-filter', Array.isArray(tc.filterBy) ? tc.filterBy : (tc.filterBy ? [tc.filterBy] : []))}</div></div>`;
  h += `<div class="admin-field"><label>目标数量</label><select id="${prefix}-ptc-count">
    <option value="1"${countVal === '1' ? ' selected' : ''}>1</option>
    <option value="2"${countVal === '2' ? ' selected' : ''}>2</option>
    <option value="3"${countVal === '3' ? ' selected' : ''}>3</option>
    <option value="all"${countVal === 'all' ? ' selected' : ''}>全部</option>
  </select></div>`;
  if (!isSelfOnlyPassiveTarget(tc)) {
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
  return `<div class="admin-onhit-row" data-idx="${i}">
    <div class="admin-onhit-toolbar">
      <span class="admin-onhit-preview">预览：${escapeAttr(formatPassiveEffectLine(e))}</span>
      <button type="button" class="btn btn-danger ${prefix}-pe-del" data-idx="${i}">删除</button>
    </div>
    <div class="admin-field"><label>展示名称</label><input class="${prefix}-pe-name" value="${escapeAttr(e.displayName || '')}"></div>
    <div class="admin-field"><label>影响数据</label><select class="${prefix}-pe-stat">${statOpts}</select></div>
    <div class="admin-field"><label>方向</label><select class="${prefix}-pe-op">
      <option value="gain"${e.op === 'gain' ? ' selected' : ''}>增加</option>
      <option value="loss"${e.op === 'loss' ? ' selected' : ''}>减少</option>
    </select></div>
    <div class="admin-field"><label>固定值</label><input class="${prefix}-pe-amount" type="number" value="${e.params.amount}"></div>
  </div>`;
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
      passiveTargetCondition: { ...DEFAULT_PASSIVE_TARGET, filterBy: ['自己'] },
      passiveTargetCount: 1,
      hpBonus: 0, hpRegenerationBonus: 0, staminaBonus: 0, staminaRegenerationBonus: 0, loadBonus: 0,
    };
  }
  const sortBy = (document.getElementById(`${prefix}-ptc-sortBy`) as HTMLSelectElement)?.value || 'random';
  const filterBy = readFilterCheckboxes(`${prefix}-ptc-filter`);
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

  const rerender = () => {
    if (!listEl) return;
    if (effects.length === 0) {
      listEl.innerHTML = `<div class="adm-field-hint">暂无效果</div>`;
    } else {
      listEl.innerHTML = effects.map((e, i) => renderPassiveEffectRow(prefix, i, e)).join('');
    }
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
