// 共享 popover 多选器——admin.ts / adminPassiveBonuses.ts / adminHitEffects.ts 共用

let _openPopoverId: string | null = null;

export function openPopover(fieldId: string) {
  if (_openPopoverId && _openPopoverId !== fieldId) {
    const prev = document.getElementById(_openPopoverId + '-panel');
    if (prev) prev.classList.remove('open');
  }
  _openPopoverId = fieldId;
  const panel = document.getElementById(fieldId + '-panel');
  if (panel) {
    panel.classList.add('open');
    const si = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
    setTimeout(() => si?.focus(), 50);
  }
}

export function closePopover(fieldId: string) {
  const panel = document.getElementById(fieldId + '-panel');
  if (panel) panel.classList.remove('open');
  if (_openPopoverId === fieldId) _openPopoverId = null;
}

export function closeAllPopovers() {
  if (_openPopoverId) {
    const panel = document.getElementById(_openPopoverId + '-panel');
    if (panel) panel.classList.remove('open');
    _openPopoverId = null;
  }
}

export function initPopoverDocClick() {
  const handler = (e: MouseEvent) => {
    if (_openPopoverId) {
      const target = e.target as HTMLElement;
      const panel = document.getElementById(_openPopoverId + '-panel');
      const trigger = document.getElementById(_openPopoverId);
      if (panel && !panel.contains(target) && trigger && !trigger.contains(target)) {
        closePopover(_openPopoverId);
      }
    }
  };
  document.addEventListener('click', handler);
}

export interface PopoverOption {
  id: string;
  name: string;
  cat?: string;
}

export interface PopoverOpts {
  allowDuplicates?: boolean;
}

export function renderPopoverSelector(
  fieldId: string,
  label: string,
  selected: string[],
  options: PopoverOption[],
  slotText?: string,
  popoverOpts?: PopoverOpts,
): string {
  const selJson = JSON.stringify(selected).replace(/"/g, '&quot;');
  const resolve = (id: string) => {
    const o = options.find(x => x.id === id);
    return o ? { name: o.name, cat: o.cat || '' } : { name: id, cat: '' };
  };
  const dup = popoverOpts?.allowDuplicates;
  return `<div class="popover-selector" id="${fieldId}" data-selected="${selJson}">
    <label>${label}${slotText ? ` <span style="font-weight:400;color:var(--adm-text-muted);">${slotText}</span>` : ''}</label>
    <div class="popover-trigger">
      <div class="popover-chips" id="${fieldId}-chips">${selected.map((s, i) => { const r = resolve(s); const idxAttr = dup ? ` data-chipidx="${i}"` : ''; return `<span class="popover-chip" data-val="${s}"${idxAttr} title="${r.name}${r.cat ? ' · ' + r.cat : ''}">${r.name}<span class="popover-chip-x" data-remove="${s}"${idxAttr}>×</span></span>`; }).join('')}</div>
      <button class="popover-open-btn" id="${fieldId}-open-btn">+ 添加</button>
    </div>
    <div class="popover-panel" id="${fieldId}-panel" style="position:absolute;">
      <div class="popover-panel-search"><input type="text" id="${fieldId}-pop-search" placeholder="搜索…" autocomplete="off"></div>
      <div class="popover-panel-list" id="${fieldId}-pop-list"></div>
    </div>
  </div>`;
}

export function refreshPopoverList(
  fieldId: string,
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
) {
  const listEl = document.getElementById(fieldId + '-pop-list');
  const searchInput = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
  if (!listEl) return;
  const q = (searchInput?.value || '').toLowerCase();
  const selected = getSelected(fieldId);
  const filtered = options.filter(o => {
    if (q) {
      const matchName = o.name.toLowerCase().includes(q);
      const matchId = o.id.toLowerCase().includes(q);
      const matchCat = (o.cat || '').toLowerCase().includes(q);
      if (!matchName && !matchId && !matchCat) return false;
    }
    return true;
  });
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="popover-panel-empty">无匹配项</div>';
    return;
  }
  const dup = popoverOpts?.allowDuplicates;
  listEl.innerHTML = filtered.map(o => {
    const isAdded = !dup && selected.includes(o.id);
    return `<div class="popover-panel-item${isAdded ? ' already-added' : ''}" data-popval="${o.id}" data-field="${fieldId}">
      <span class="popover-item-name">${o.name}</span>
      ${o.cat ? `<span class="popover-item-cat">${o.cat}</span>` : ''}
      ${isAdded ? '<span class="popover-item-added">已添加</span>' : ''}
    </div>`;
  }).join('');
}

export function addPopoverItem(
  fieldId: string,
  val: string,
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
) {
  const cur = getSelected(fieldId);
  if (!popoverOpts?.allowDuplicates && cur.includes(val)) return;
  updatePopoverField(fieldId, [...cur, val], options, popoverOpts);
}

export function bindPopoverChipRemoval(
  fieldId: string,
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
  onUpdate?: (updated: string[]) => void,
) {
  document.querySelectorAll(`#${fieldId} .popover-chip-x`).forEach(rm => {
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      let updated: string[];
      if (popoverOpts?.allowDuplicates) {
        const idx = parseInt((rm as HTMLElement).dataset.chipidx!);
        updated = getSelected(fieldId).filter((_, i) => i !== idx);
      } else {
        const val = (rm as HTMLElement).dataset.remove!;
        updated = getSelected(fieldId).filter(s => s !== val);
      }
      updatePopoverField(fieldId, updated, options, popoverOpts);
      onUpdate?.(updated);
    });
  });
}

export function updatePopoverField(
  fieldId: string,
  updated: string[],
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
) {
  const el = document.getElementById(fieldId)!;
  el.dataset.selected = JSON.stringify(updated);
  const resolve = (id: string) => {
    const o = options.find(x => x.id === id);
    return o ? { name: o.name, cat: o.cat || '' } : { name: id, cat: '' };
  };
  const chipsEl = document.getElementById(fieldId + '-chips')!;
  const dup = popoverOpts?.allowDuplicates;
  chipsEl.innerHTML = updated.map((s, i) => { const r = resolve(s); const idxAttr = dup ? ` data-chipidx="${i}"` : ''; return `<span class="popover-chip" data-val="${s}"${idxAttr} title="${r.name}${r.cat ? ' · ' + r.cat : ''}">${r.name}<span class="popover-chip-x" data-remove="${s}"${idxAttr}>×</span></span>`; }).join('');
  bindPopoverChipRemoval(fieldId, options, popoverOpts);
  refreshPopoverList(fieldId, options, popoverOpts);
}

export function getSelected(fieldId: string): string[] {
  const el = document.getElementById(fieldId);
  if (!el) return [];
  try { return JSON.parse((el.dataset.selected || '[]').replace(/&quot;/g, '"')); } catch { return []; }
}

export function bindPopoverSelector(
  fieldId: string,
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
  onUpdate?: (updated: string[]) => void,
) {
  const el = document.getElementById(fieldId)!;
  const dup = popoverOpts?.allowDuplicates;

  const openBtn = document.getElementById(fieldId + '-open-btn');
  openBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_openPopoverId === fieldId) { closePopover(fieldId); return; }
    refreshPopoverList(fieldId, options, popoverOpts);
    openPopover(fieldId);
  });

  const trigger = el.querySelector('.popover-trigger') as HTMLElement;
  trigger?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.popover-chip-x')) return;
    if (_openPopoverId === fieldId) return;
    e.stopPropagation();
    refreshPopoverList(fieldId, options, popoverOpts);
    openPopover(fieldId);
  });

  const searchInput = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => refreshPopoverList(fieldId, options, popoverOpts));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePopover(fieldId); return; }
    if (e.key === 'Enter') {
      const sel = dup ? '.popover-panel-item' : '.popover-panel-item:not(.already-added)';
      const first = document.querySelector(`#${fieldId}-pop-list ${sel}`) as HTMLElement;
      if (first) {
        const val = first.dataset.popval!;
        handleAddPopoverItem(fieldId, val, options, popoverOpts, onUpdate);
      }
    }
  });

  const panel = document.getElementById(fieldId + '-panel');
  panel?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.popover-panel-item') as HTMLElement;
    if (!item || (!dup && item.classList.contains('already-added'))) return;
    const val = item.dataset.popval!;
    handleAddPopoverItem(fieldId, val, options, popoverOpts, onUpdate);
  });

  bindPopoverChipRemoval(fieldId, options, popoverOpts, onUpdate);
}

function handleAddPopoverItem(
  fieldId: string,
  val: string,
  options: PopoverOption[],
  popoverOpts?: PopoverOpts,
  onUpdate?: (updated: string[]) => void,
) {
  const cur = getSelected(fieldId);
  if (!popoverOpts?.allowDuplicates && cur.includes(val)) return;
  const updated = [...cur, val];
  updatePopoverField(fieldId, updated, options, popoverOpts);
  onUpdate?.(updated);
}
