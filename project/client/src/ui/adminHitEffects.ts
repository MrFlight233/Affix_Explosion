// Admin 命中效果列表编辑器

import {
  defaultDisplayName,
  migrateLegacyDamageToOnHitEffects,
  normalizeOnHitEffects,
  type OnHitEffect,
  type OnHitOp,
  type OnHitStat,
} from '../game/hitEffectUtil';
import { formatConfigEffectLines } from '../game/activeActionDisplay';

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

function previewLines(e: OnHitEffect): string {
  const lines = formatConfigEffectLines(e);
  return lines.length ? lines.join('；') : '（未配置量）';
}

function renderOnHitRow(prefix: string, i: number, e: OnHitEffect): string {
  const amount = e.params?.amount;
  const percent = e.params?.percent;
  const hasAmount = Object.prototype.hasOwnProperty.call(e.params || {}, 'amount');
  const apply = new Set(e.applyTo && e.applyTo.length ? e.applyTo : ['target']);
  return `<div class="admin-onhit-row" data-idx="${i}">
    <div class="admin-onhit-toolbar">
      <span class="admin-onhit-preview">预览：${escapeAttr(previewLines(e))}</span>
      <button type="button" class="btn btn-danger ${prefix}-del" data-idx="${i}">删除</button>
    </div>
    <div class="admin-field"><label>展示名称</label><input class="${prefix}-name" value="${escapeAttr(e.displayName || '')}"></div>
    <div class="admin-field"><label>数据</label><select class="${prefix}-stat">
      <option value="hp"${e.stat === 'hp' ? ' selected' : ''}>HP</option>
      <option value="stamina"${e.stat === 'stamina' ? ' selected' : ''}>耐力</option>
    </select></div>
    <div class="admin-field"><label>方向</label><select class="${prefix}-op">
      <option value="loss"${e.op === 'loss' ? ' selected' : ''}>减少</option>
      <option value="gain"${e.op === 'gain' ? ' selected' : ''}>增加</option>
      <option value="set"${e.op === 'set' ? ' selected' : ''}>变为</option>
    </select></div>
    <div class="admin-field"><label>固定值</label><input class="${prefix}-amount" type="number" value="${hasAmount ? amount : ''}" placeholder="不填=不用"></div>
    <div class="admin-field"><label>百分比</label><input class="${prefix}-percent" type="number" value="${percent !== undefined && percent !== 0 ? percent : (percent === 0 && hasAmount ? '' : (percent || ''))}" placeholder="相对命中量"></div>
    <div class="admin-field"><label>作用对象</label>
      <label><input type="checkbox" class="${prefix}-apply" value="target"${apply.has('target') ? ' checked' : ''}> 被命中</label>
      <label><input type="checkbox" class="${prefix}-apply" value="actionOwner"${apply.has('actionOwner') ? ' checked' : ''}> 被触发</label>
      <label><input type="checkbox" class="${prefix}-apply" value="starter"${apply.has('starter') ? ' checked' : ''}> 启动端</label>
    </div>
  </div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function readOnHitEffectFromRow(prefix: string, row: Element): OnHitEffect {
  const nameEl = row.querySelector(`.${prefix}-name`) as HTMLInputElement;
  const stat = (row.querySelector(`.${prefix}-stat`) as HTMLSelectElement).value as OnHitStat;
  const op = (row.querySelector(`.${prefix}-op`) as HTMLSelectElement).value as OnHitOp;
  const amountInput = row.querySelector(`.${prefix}-amount`) as HTMLInputElement;
  const percentInput = row.querySelector(`.${prefix}-percent`) as HTMLInputElement;
  const params: { amount?: number; percent?: number } = {};
  if (amountInput.value.trim() !== '') params.amount = parseFloat(amountInput.value) || 0;
  if (percentInput.value.trim() !== '') params.percent = parseFloat(percentInput.value) || 0;
  const applyTo: OnHitEffect['applyTo'] = [];
  row.querySelectorAll(`.${prefix}-apply:checked`).forEach(cb => {
    applyTo!.push((cb as HTMLInputElement).value as NonNullable<OnHitEffect['applyTo']>[number]);
  });
  let displayName = (nameEl?.value || '').trim();
  if (!displayName) displayName = defaultDisplayName(stat, op);
  const effect: OnHitEffect = { displayName, stat, op, params };
  if (applyTo && applyTo.length > 0) effect.applyTo = applyTo;
  return effect;
}

function updateRowPreview(prefix: string, row: Element): void {
  const previewEl = row.querySelector('.admin-onhit-preview');
  if (!previewEl) return;
  previewEl.textContent = `预览：${previewLines(readOnHitEffectFromRow(prefix, row))}`;
}

export function readOnHitEffectsFromDom(prefix: string): OnHitEffect[] {
  const list = document.getElementById(`${prefix}-list`);
  if (!list) return [];
  const out: OnHitEffect[] = [];
  list.querySelectorAll('.admin-onhit-row').forEach(row => {
    out.push(readOnHitEffectFromRow(prefix, row));
  });
  return out;
}

function bindRowInteractions(prefix: string, listEl: HTMLElement, onDelete: (idx: number) => void): void {
  listEl.querySelectorAll('.admin-onhit-row').forEach(row => {
    const refresh = () => updateRowPreview(prefix, row);
    row.querySelectorAll(`.${prefix}-name, .${prefix}-amount, .${prefix}-percent`).forEach(el => {
      el.addEventListener('input', refresh);
      el.addEventListener('change', refresh);
    });
    row.querySelectorAll(`.${prefix}-stat, .${prefix}-op`).forEach(el => {
      el.addEventListener('change', refresh);
    });
    row.querySelectorAll(`.${prefix}-apply`).forEach(el => {
      el.addEventListener('change', refresh);
    });
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

  const rerender = () => {
    if (effects.length === 0) {
      listEl.innerHTML = `<div class="adm-field-hint">暂无效果</div>`;
    } else {
      listEl.innerHTML = effects.map((e, i) => renderOnHitRow(prefix, i, e)).join('');
    }
    bindRowInteractions(prefix, listEl, (idx) => {
      effects = readOnHitEffectsFromDom(prefix);
      effects.splice(idx, 1);
      rerender();
    });
  };

  addBtn?.addEventListener('click', () => {
    effects = readOnHitEffectsFromDom(prefix);
    effects.push({
      displayName: '伤害',
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
