// Admin 命中效果列表编辑器（先选数据 → 再定即时/持续与 Tick）

import {
  CHASSIS_STATS,
  defaultDisplayName,
  INSTANT_STATS,
  migrateLegacyDamageToOnHitEffects,
  normalizeOnHitEffect,
  normalizeOnHitEffects,
  resolveHitDisplayName,
  resolveHitBuffKey,
  type OnHitEffect,
  type OnHitKind,
  type OnHitOp,
  type OnHitStat,
} from '../game/hitEffectUtil';
import type { SubtreeCondition } from '@shared/types';
import { formatConfigEffectLines } from '../game/activeActionDisplay';
import { conditionPreviewPrefix } from '../game/targetingUtil';
import {
  renderPopoverSelector,
  bindPopoverSelector,
  getSelected,
} from './admin/popoverSelector';

let _hitAffixOpts: { id: string; name: string; cat?: string }[] = [];

export function setHitAffixOpts(opts: { id: string; name: string; cat?: string }[]) {
  _hitAffixOpts = opts;
}

const STAT_OPTIONS: { value: OnHitStat; label: string }[] = [
  { value: 'hp', label: 'HP' },
  { value: 'stamina', label: '耐力' },
  { value: 'remainingTime', label: '倒计时' },
  { value: 'maxHp', label: 'HP上限' },
  { value: 'maxStamina', label: '耐力上限' },
  { value: 'maxLoad', label: '负重上限' },
  { value: 'hpRegen', label: '生命恢复' },
  { value: 'staminaRegen', label: '耐力恢复' },
  { value: 'actionTime', label: '触发耗时' },
  { value: 'staminaCost', label: '耐力消耗' },
  { value: 'burden', label: '重压' },
];

function isChassisStatValue(stat: OnHitStat): boolean {
  return CHASSIS_STATS.has(stat);
}

function isInstantStatValue(stat: OnHitStat): boolean {
  return INSTANT_STATS.has(stat);
}

/** 全部数据选项（始终展示） */
function allStatOptionsHtml(selected: OnHitStat): string {
  const instant = STAT_OPTIONS.filter(o => INSTANT_STATS.has(o.value))
    .map(o => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${o.label}</option>`)
    .join('');
  const chassis = STAT_OPTIONS.filter(o => CHASSIS_STATS.has(o.value))
    .map(o => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${o.label}</option>`)
    .join('');
  return `<optgroup label="当前池 / 倒计时">${instant}</optgroup>`
    + `<optgroup label="上限 / 回复 / 武器 / 重压">${chassis}</optgroup>`;
}

function modeHint(stat: OnHitStat, kind: OnHitKind): string {
  if (isChassisStatValue(stat)) {
    return '该数据仅支持「持续底盘」：填持续时长，不使用 Tick';
  }
  if (kind === 'duration') {
    return '当前池数据的持续形态为 Tick 壳：须填 Tick 间隔（如毒）';
  }
  return '即时结算一次；若要周期性跳，将类型改为「持续」并填 Tick';
}

export function renderOnHitEffectsEditor(prefix: string, effects: OnHitEffect[]): string {
  const list = normalizeOnHitEffects(effects || []);
  let h = `<div class="admin-onhit-list" id="${prefix}-list" data-prefix="${prefix}">`;
  if (list.length === 0) {
    h += `<div class="adm-field-hint">暂无效果</div>`;
  }
  list.forEach((e, i) => { h += renderOnHitRow(prefix, i, e); });
  h += `</div>`;
  h += `<button type="button" class="btn" id="${prefix}-add">添加效果</button>`;
  return h;
}

function previewLines(e: OnHitEffect, cond?: SubtreeCondition): string {
  const prefix = conditionPreviewPrefix(cond, _hitAffixOpts);
  const lines = formatConfigEffectLines(e);
  const body = lines.length ? lines.join('；') : '（未配置量或配置不合法）';
  return prefix + body;
}

function renderOnHitRow(prefix: string, i: number, e: OnHitEffect): string {
  const amount = e.params?.amount;
  const percent = e.params?.percent;
  const hasAmount = Object.prototype.hasOwnProperty.call(e.params || {}, 'amount');
  const apply = new Set(e.applyTo && e.applyTo.length ? e.applyTo : ['target']);

  let kind: OnHitKind = e.kind || 'instant';
  let stat = e.stat || 'hp';
  if (!INSTANT_STATS.has(stat) && !CHASSIS_STATS.has(stat)) stat = 'hp';

  // 底盘属性强制持续、无 Tick
  const chassis = isChassisStatValue(stat);
  if (chassis) kind = 'duration';
  const tick = chassis ? 0 : (e.tickIntervalMs ?? 0);
  // 即时属性若带 duration 但无 tick，预览按即时处理（保存时会拦）
  if (!chassis && kind === 'duration' && tick <= 0 && (e.durationMs ?? 0) <= 0) {
    kind = 'instant';
  }

  const showDuration = kind === 'duration';
  const showTick = showDuration && !chassis;
  const op = kind === 'duration' && e.op === 'set' ? 'gain' : e.op;

  const kindSelect = chassis
    ? `<select class="${prefix}-kind" disabled title="该数据仅支持持续"><option value="duration" selected>持续</option></select>`
      + `<input type="hidden" class="${prefix}-kind-value" value="duration">`
    : `<select class="${prefix}-kind">
        <option value="instant"${kind === 'instant' ? ' selected' : ''}>即时</option>
        <option value="duration"${kind === 'duration' ? ' selected' : ''}>持续</option>
      </select>`;

  return `<div class="admin-onhit-row" data-idx="${i}">
    <div class="admin-onhit-toolbar">
      <span class="admin-onhit-preview">预览：${escapeAttr(previewLines({
        ...e, kind, stat, op,
        tickIntervalMs: showTick && tick > 0 ? tick : undefined,
        durationMs: showDuration ? e.durationMs : undefined,
      }, (e as any).condition as SubtreeCondition | undefined))}</span>
      <button type="button" class="btn btn-danger ${prefix}-del" data-idx="${i}">删除</button>
    </div>
    <div class="admin-field"><label>展示名称</label><input class="${prefix}-name" value="${escapeAttr(e.displayName || '')}"></div>
    <div class="admin-field ${prefix}-buffkey-wrap" style="${showDuration ? '' : 'display:none'}">
      <label>buffKey</label>
      <input class="${prefix}-buffkey" value="${escapeAttr(e.buffKey || '')}" placeholder="默认=展示名">
      <div class="adm-field-hint" style="padding-top:2px;font-size:0.85em;color:#888">空展示名/空 buffKey 会共用宿主名；多条持续请填不同展示名或 buffKey</div>
    </div>
    <div class="admin-field"><label>影响数据</label><select class="${prefix}-stat">${allStatOptionsHtml(stat)}</select></div>
    <div class="admin-field"><label>类型</label>${kindSelect}</div>
    <div class="adm-field-hint ${prefix}-mode-hint" style="padding-top:0;">${escapeAttr(modeHint(stat, kind))}</div>
    <div class="admin-field"><label>方向</label><select class="${prefix}-op">
      <option value="loss"${op === 'loss' ? ' selected' : ''}>减少</option>
      <option value="gain"${op === 'gain' ? ' selected' : ''}>增加</option>
      ${kind === 'instant' ? `<option value="set"${op === 'set' ? ' selected' : ''}>变为（仅即时）</option>` : ''}
    </select></div>
    <div class="admin-field"><label>固定值</label><input class="${prefix}-amount" type="number" value="${hasAmount ? amount : ''}" placeholder="不填=不用"></div>
    <div class="admin-field"><label>百分比</label><input class="${prefix}-percent" type="number" value="${percent !== undefined && percent !== 0 ? percent : (percent === 0 && hasAmount ? '' : (percent || ''))}" placeholder="相对属性上限"></div>
    <div class="${prefix}-duration-fields" style="${showDuration ? '' : 'display:none'}">
      <div class="admin-field"><label>持续时长ms</label><input class="${prefix}-duration" type="number" value="${e.durationMs || ''}" placeholder="持续必填"></div>
      <div class="admin-field ${prefix}-tick-wrap" style="${showTick ? '' : 'display:none'}">
        <label>Tick间隔ms</label>
        <input class="${prefix}-tick" type="number" value="${showTick ? (e.tickIntervalMs || '') : ''}" placeholder="必填（毒等）">
      </div>
    </div>
    <div class="admin-field"><label>作用对象</label>
      <label><input type="checkbox" class="${prefix}-apply" value="target"${apply.has('target') ? ' checked' : ''}> 被命中</label>
      <label><input type="checkbox" class="${prefix}-apply" value="actionOwner"${apply.has('actionOwner') ? ' checked' : ''}> 被触发</label>
      <label><input type="checkbox" class="${prefix}-apply" value="starter"${apply.has('starter') ? ' checked' : ''}> 启动端</label>
    </div>
    ${renderHitConditionEditor(prefix, i, e)}
  </div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderHitConditionEditor(prefix: string, i: number, e: OnHitEffect): string {
  const cond = (e as any).condition as SubtreeCondition | undefined;
  const hasCond = !!cond;
  const matchIds = cond?.matchIds || [];
  const direction = cond?.max !== undefined ? '<=' : '>=';
  const val = cond?.min !== undefined ? String(cond.min) : cond?.max !== undefined ? String(cond.max) : '1';

  return `<div class="admin-field"><label>触发条件</label><select class="${prefix}-cond-sel" data-idx="${i}">
    <option value="有"${hasCond ? ' selected' : ''}>有</option>
    <option value="无"${!hasCond ? ' selected' : ''}>无</option>
  </select></div>
  <div id="${prefix}-cond-body-${i}" style="${hasCond ? '' : 'display:none'}">
    ${renderPopoverSelector(`${prefix}-cond-ids-${i}`, '需求词条', matchIds, _hitAffixOpts)}
    <div class="admin-field" style="display:flex;gap:4px;align-items:center"><label>条件</label><select class="${prefix}-cond-dir">
      <option value=">=" ${direction === '>=' ? 'selected' : ''}>≥</option>
      <option value="<=" ${direction === '<=' ? 'selected' : ''}>≤</option>
    </select></div>
    <div class="admin-field"><label>数量</label><input class="${prefix}-cond-val" type="number" value="${escapeAttr(val)}" min="0" style="width:80px"></div>
  </div>`;
}

function readKind(prefix: string, row: Element): OnHitKind {
  const hidden = row.querySelector(`.${prefix}-kind-value`) as HTMLInputElement | null;
  if (hidden) return 'duration';
  const kindEl = row.querySelector(`.${prefix}-kind`) as HTMLSelectElement | null;
  return (kindEl?.value as OnHitKind) || 'instant';
}

function readOnHitEffectFromRow(prefix: string, row: Element): OnHitEffect {
  const nameEl = row.querySelector(`.${prefix}-name`) as HTMLInputElement | null;
  const statEl = row.querySelector(`.${prefix}-stat`) as HTMLSelectElement | null;
  const opEl = row.querySelector(`.${prefix}-op`) as HTMLSelectElement | null;
  if (!statEl || !opEl) {
    throw new Error('效果行控件缺失，请刷新后重试');
  }
  const stat = statEl.value as OnHitStat;
  let kind = readKind(prefix, row);
  const chassis = isChassisStatValue(stat);
  if (chassis) kind = 'duration';

  const op = opEl.value as OnHitOp;
  const amountInput = row.querySelector(`.${prefix}-amount`) as HTMLInputElement;
  const percentInput = row.querySelector(`.${prefix}-percent`) as HTMLInputElement;
  const durationInput = row.querySelector(`.${prefix}-duration`) as HTMLInputElement;
  const tickInput = row.querySelector(`.${prefix}-tick`) as HTMLInputElement;
  const buffKeyInput = row.querySelector(`.${prefix}-buffkey`) as HTMLInputElement;
  const params: { amount?: number; percent?: number } = {};
  if (amountInput?.value.trim() !== '') params.amount = parseFloat(amountInput.value) || 0;
  if (percentInput?.value.trim() !== '') params.percent = parseFloat(percentInput.value) || 0;
  const applyTo: OnHitEffect['applyTo'] = [];
  row.querySelectorAll(`.${prefix}-apply:checked`).forEach(cb => {
    applyTo!.push((cb as HTMLInputElement).value as NonNullable<OnHitEffect['applyTo']>[number]);
  });
  let displayName = (nameEl?.value || '').trim();
  const effect: OnHitEffect = { displayName, kind, stat, op, params };
  if (kind === 'duration') {
    effect.durationMs = parseFloat(durationInput?.value || '') || 0;
    // 底盘：强制不写 Tick；即时属性持续：读 Tick（可为空，保存时校验）
    if (!chassis) {
      const tick = parseFloat(tickInput?.value || '') || 0;
      if (tick > 0) effect.tickIntervalMs = tick;
    }
    const key = (buffKeyInput?.value || '').trim();
    effect.buffKey = key;
  }
  if (applyTo && applyTo.length > 0) effect.applyTo = applyTo;

  // 触发条件读取
  const selEl = (row.querySelector(`.${prefix}-cond-sel`) as HTMLSelectElement);
  if (selEl?.value === '有') {
    const idx = (row as HTMLElement).dataset.idx || '0';
    const matchIds = getSelected(`${prefix}-cond-ids-${idx}`);
    if (matchIds.length > 0) {
      const dir = (row.querySelector(`.${prefix}-cond-dir`) as HTMLSelectElement)?.value || '>=';
      const val = parseInt(((row.querySelector(`.${prefix}-cond-val`) as HTMLInputElement)?.value || ''), 10);
      const cond: SubtreeCondition = { matchIds };
      if (!isNaN(val)) {
        if (dir === '<=') cond.max = val;
        else cond.min = val;
      }
      (effect as any).condition = cond;
    }
  }

  return effect;
}

/**
 * 根据「影响数据」重建类型选项，并显隐持续区 / Tick。
 * Tick 不展示时清空，保证留空。
 */
function syncKindTickUi(prefix: string, row: Element): void {
  const statEl = row.querySelector(`.${prefix}-stat`) as HTMLSelectElement | null;
  const opEl = row.querySelector(`.${prefix}-op`) as HTMLSelectElement | null;
  const durBox = row.querySelector(`.${prefix}-duration-fields`) as HTMLElement | null;
  const buffKeyWrap = row.querySelector(`.${prefix}-buffkey-wrap`) as HTMLElement | null;
  const tickWrap = row.querySelector(`.${prefix}-tick-wrap`) as HTMLElement | null;
  const tickInput = row.querySelector(`.${prefix}-tick`) as HTMLInputElement | null;
  const hint = row.querySelector(`.${prefix}-mode-hint`);
  if (!statEl) return;

  const stat = statEl.value as OnHitStat;
  const chassis = isChassisStatValue(stat);

  const kindField = Array.from(row.querySelectorAll('.admin-field')).find(el => {
    const lab = el.querySelector(':scope > label');
    return lab && lab.textContent === '类型';
  }) as HTMLElement | undefined;

  let kind: OnHitKind = readKind(prefix, row);
  if (chassis) kind = 'duration';
  else if (kind !== 'instant' && kind !== 'duration') kind = 'instant';

  if (kindField) {
    const prevKind = kind;
    if (chassis) {
      kindField.innerHTML = `<label>类型</label>`
        + `<select class="${prefix}-kind" disabled title="该数据仅支持持续"><option value="duration" selected>持续</option></select>`
        + `<input type="hidden" class="${prefix}-kind-value" value="duration">`;
      kind = 'duration';
    } else {
      kindField.innerHTML = `<label>类型</label><select class="${prefix}-kind">
        <option value="instant"${prevKind === 'instant' ? ' selected' : ''}>即时</option>
        <option value="duration"${prevKind === 'duration' ? ' selected' : ''}>持续</option>
      </select>`;
      const sel = kindField.querySelector(`.${prefix}-kind`) as HTMLSelectElement;
      kind = (sel?.value as OnHitKind) || 'instant';
      sel?.addEventListener('change', () => {
        syncKindTickUi(prefix, row);
        updateRowPreview(prefix, row);
      });
    }
  }

  const showDuration = kind === 'duration';
  const showTick = showDuration && !chassis;
  if (durBox) durBox.style.display = showDuration ? '' : 'none';
  if (buffKeyWrap) buffKeyWrap.style.display = showDuration ? '' : 'none';
  if (tickWrap) tickWrap.style.display = showTick ? '' : 'none';
  if (!showTick && tickInput) tickInput.value = '';

  if (opEl) {
    const prevOp = opEl.value as OnHitOp;
    let nextOp: OnHitOp = prevOp;
    if (kind === 'duration' && prevOp === 'set') nextOp = 'gain';
    opEl.innerHTML = `
      <option value="loss"${nextOp === 'loss' ? ' selected' : ''}>减少</option>
      <option value="gain"${nextOp === 'gain' ? ' selected' : ''}>增加</option>
      ${kind === 'instant' ? `<option value="set"${nextOp === 'set' ? ' selected' : ''}>变为（仅即时）</option>` : ''}
    `;
  }

  if (hint) hint.textContent = modeHint(stat, kind);
}

function updateRowPreview(prefix: string, row: Element): void {
  const previewEl = row.querySelector('.admin-onhit-preview');
  if (!previewEl) return;
  const effect = readOnHitEffectFromRow(prefix, row);
  previewEl.textContent = `预览：${previewLines(effect, (effect as any).condition as SubtreeCondition | undefined)}`;
}

/** 原始 DOM 读取（不做 normalize） */
export function readOnHitEffectsFromDom(prefix: string): OnHitEffect[] {
  const list = document.getElementById(`${prefix}-list`);
  if (!list) return [];
  const out: OnHitEffect[] = [];
  list.querySelectorAll('.admin-onhit-row').forEach(row => {
    out.push(readOnHitEffectFromRow(prefix, row));
  });
  return out;
}

export interface CollectOnHitResult {
  effects: OnHitEffect[];
  dropped: number;
  rawCount: number;
  /** 额外：即时属性选了持续但未填 Tick */
  tickRequiredMissing: number;
}

/** 保存用：normalize + Tick 壳必填检查 */
export function collectOnHitEffectsFromDom(prefix: string): CollectOnHitResult {
  const raw = readOnHitEffectsFromDom(prefix);
  const effects: OnHitEffect[] = [];
  let dropped = 0;
  let tickRequiredMissing = 0;
  for (const item of raw) {
    if (
      item.kind === 'duration'
      && isInstantStatValue(item.stat)
      && !(item.tickIntervalMs && item.tickIntervalMs > 0)
    ) {
      tickRequiredMissing++;
      continue;
    }
    const n = normalizeOnHitEffect(item);
    if (n) effects.push(n);
    else dropped++;
  }
  return { effects, dropped, rawCount: raw.length, tickRequiredMissing };
}

function bindRowInteractions(prefix: string, listEl: HTMLElement, onDelete: (idx: number) => void): void {
  listEl.querySelectorAll('.admin-onhit-row').forEach(row => {
    const refresh = () => updateRowPreview(prefix, row);
    row.querySelectorAll(
      `.${prefix}-name, .${prefix}-amount, .${prefix}-percent, .${prefix}-duration, .${prefix}-buffkey, .${prefix}-tick`,
    ).forEach(el => {
      el.addEventListener('input', refresh);
      el.addEventListener('change', refresh);
    });
    row.querySelector(`.${prefix}-stat`)?.addEventListener('change', () => {
      syncKindTickUi(prefix, row);
      refresh();
    });
    row.querySelector(`.${prefix}-kind`)?.addEventListener('change', () => {
      syncKindTickUi(prefix, row);
      refresh();
    });
    row.querySelector(`.${prefix}-op`)?.addEventListener('change', refresh);
    row.querySelectorAll(`.${prefix}-apply`).forEach(el => {
      el.addEventListener('change', refresh);
    });
    syncKindTickUi(prefix, row);
  });
  listEl.querySelectorAll(`.${prefix}-del`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '-1', 10);
      if (idx >= 0) onDelete(idx);
    });
  });
}

export function bindOnHitEffectsEditor(prefix: string, initial: OnHitEffect[]): void {
  let effects = normalizeOnHitEffects(initial || []);
  const listEl = document.getElementById(`${prefix}-list`);
  const addBtn = document.getElementById(`${prefix}-add`);
  if (!listEl) return;

  const rebindConditions = () => {
    listEl.querySelectorAll(`.${prefix}-cond-sel`).forEach((sel) => {
      const row = (sel as HTMLElement).closest('.admin-onhit-row') as HTMLElement;
      if (!row) return;
      const idx = row.dataset.idx || '0';
      const body = document.getElementById(`${prefix}-cond-body-${idx}`);

      (sel as HTMLSelectElement).addEventListener('change', () => {
        if (body) body.style.display = (sel as HTMLSelectElement).value === '有' ? '' : 'none';
        updateRowPreview(prefix, row);
      });

      row.querySelectorAll(`.${prefix}-cond-dir, .${prefix}-cond-val`).forEach(el => {
        el.addEventListener('input', () => updateRowPreview(prefix, row));
        el.addEventListener('change', () => updateRowPreview(prefix, row));
      });

      const fieldId = `${prefix}-cond-ids-${idx}`;
      if (document.getElementById(fieldId)) {
        bindPopoverSelector(fieldId, _hitAffixOpts, undefined, () => {
          updateRowPreview(prefix, row);
        });
      }
    });
  };

  const rerender = () => {
    if (effects.length === 0) {
      listEl.innerHTML = `<div class="adm-field-hint">暂无效果</div>`;
    } else {
      listEl.innerHTML = effects.map((e, i) => renderOnHitRow(prefix, i, e)).join('');
    }
    rebindConditions();
    bindRowInteractions(prefix, listEl, (idx) => {
      effects = readOnHitEffectsFromDom(prefix);
      effects.splice(idx, 1);
      rerender();
    });
  };

  addBtn?.addEventListener('click', () => {
    effects = readOnHitEffectsFromDom(prefix);
    effects.push({
      displayName: '',
      kind: 'instant',
      stat: 'hp',
      op: 'loss',
      params: { amount: 0 },
      applyTo: ['target'],
    });
    rerender();
  });

  bindRowInteractions(prefix, listEl, (idx) => {
    effects = readOnHitEffectsFromDom(prefix);
    effects.splice(idx, 1);
    rerender();
  });
}

export function entityInitialOnHitEffects(data: any): OnHitEffect[] {
  return migrateLegacyDamageToOnHitEffects(data?.onHitEffects, Number(data?.damage) || 0);
}
