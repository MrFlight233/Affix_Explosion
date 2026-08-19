// Admin：效果库引用编辑器（多选 EffectDef + 数字填参）

import type { EffectBinding, EffectDef } from '@shared/effectDef';
import { EFFECT_DEFS } from '../game/data';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function listEffectsForChannel(mode: 'active' | 'passive'): EffectDef[] {
  return EFFECT_DEFS.filter(e => (mode === 'active' ? e.allowActive : e.allowPassive))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

export function renderEffectBindingsEditor(
  prefix: string,
  mode: 'active' | 'passive',
  bindings: EffectBinding[],
): string {
  const opts = listEffectsForChannel(mode);
  const rows = (bindings || []).map((b, i) => {
    const def = EFFECT_DEFS.find(e => e.id === b.effectId);
    const amount = b.params?.amount ?? def?.defaultParams?.amount ?? '';
    const optionHtml = opts.map(o =>
      `<option value="${escapeAttr(o.id)}" ${o.id === b.effectId ? 'selected' : ''}>${escapeAttr(o.name)} (${escapeAttr(o.id)})</option>`,
    ).join('');
    return `<div class="adm-effect-bind-row" data-idx="${i}">
      <select class="adm-input" data-bind="effectId">${optionHtml || '<option value="">（无可用效果）</option>'}</select>
      <input class="adm-input" type="number" data-bind="amount" placeholder="数量" value="${amount}" style="width:6rem" />
      <button type="button" class="adm-btn" data-act="rm">删</button>
    </div>`;
  }).join('');
  return `<div class="adm-effect-bindings" data-prefix="${escapeAttr(prefix)}" data-mode="${mode}">
    <div class="adm-effect-bind-list">${rows}</div>
    <button type="button" class="adm-btn" data-act="add">+ 引用效果</button>
    <p class="adm-hint">请先在「效果」页创建配方；此处仅引用并填写数量。</p>
  </div>`;
}

export function readEffectBindingsFromDom(prefix: string): EffectBinding[] {
  const root = document.querySelector(`.adm-effect-bindings[data-prefix="${prefix}"]`);
  if (!root) return [];
  const rows = [...root.querySelectorAll('.adm-effect-bind-row')];
  const out: EffectBinding[] = [];
  rows.forEach((row, order) => {
    const effectId = (row.querySelector('[data-bind="effectId"]') as HTMLSelectElement)?.value?.trim();
    if (!effectId) return;
    const amountRaw = (row.querySelector('[data-bind="amount"]') as HTMLInputElement)?.value;
    const binding: EffectBinding = { effectId, order };
    if (amountRaw !== '' && amountRaw != null && Number.isFinite(Number(amountRaw))) {
      binding.params = { amount: Number(amountRaw) };
    }
    out.push(binding);
  });
  return out;
}

export function bindEffectBindingsEditor(prefix: string): void {
  const root = document.querySelector(`.adm-effect-bindings[data-prefix="${prefix}"]`) as HTMLElement | null;
  if (!root) return;
  const mode = (root.dataset.mode || 'active') as 'active' | 'passive';
  root.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    const act = t.getAttribute('data-act');
    if (act === 'add') {
      const opts = listEffectsForChannel(mode);
      const first = opts[0];
      const list = root.querySelector('.adm-effect-bind-list');
      if (!list || !first) return;
      const bindings = readEffectBindingsFromDom(prefix);
      bindings.push({ effectId: first.id, order: bindings.length });
      list.outerHTML = renderEffectBindingsEditor(prefix, mode, bindings).match(/<div class="adm-effect-bind-list">[\s\S]*?<\/div>/)?.[0]
        || list.outerHTML;
      // 重绘整块更稳
      const parent = root.parentElement;
      if (parent) {
        const html = renderEffectBindingsEditor(prefix, mode, bindings);
        root.outerHTML = html;
        bindEffectBindingsEditor(prefix);
      }
      return;
    }
    if (act === 'rm') {
      const row = t.closest('.adm-effect-bind-row');
      row?.remove();
    }
  };
}
