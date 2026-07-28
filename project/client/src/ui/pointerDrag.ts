// ============================================================
// Pointer 拖拽引擎 — 自控命中 / ghost / gap，松手一次提交
// 约定 DOM：
//   [data-sort-list="top|child|affix"][data-side][data-instance?][data-accept]
//   列表内可排序项：[data-sort-item][data-instance]
//   空槽：.sb-empty-slot[data-dropzone][data-instance][data-side]
//   卸下区：#sb-pool
// ============================================================

export type PointerDragKind = 'entity' | 'affix';
export type PointerDragSource = 'bd' | 'pool';

export interface PointerDragSession {
  kind: PointerDragKind;
  source: PointerDragSource;
  /** BD 内为 instanceId；池内为 defId */
  id: string;
  defId: string;
  side?: 'player' | 'enemy';
  label: string;
  originEl: HTMLElement;
}

export interface PointerDragHit {
  action: 'reorder' | 'mount' | 'remove' | 'invalid';
  side?: 'player' | 'enemy';
  listKind?: 'top' | 'child' | 'affix';
  /** mount/reorder 的父；top 层为 null */
  parentInstanceId?: string | null;
  insertIndex?: number;
}

export interface PointerDragHandlers {
  /** 提交；返回错误文案则由引擎 toast */
  onCommit: (session: PointerDragSession, hit: PointerDragHit) => string | null;
  onCancel?: () => void;
}

interface ActiveDrag {
  session: PointerDragSession;
  handlers: PointerDragHandlers;
  pointerId: number;
  startX: number;
  startY: number;
  activated: boolean;
  ghost: HTMLElement;
  gap: HTMLElement;
  lastHit: PointerDragHit;
  lastGapKey: string;
}

let active: ActiveDrag | null = null;
let suppressNextClick = false;

const MOVE_THRESHOLD = 6;

/** ghost/gap 挂到 #sb-page 以继承 --sb-*；无页面时退回 body */
function dragHost(): HTMLElement {
  return (document.getElementById('sb-page') as HTMLElement | null) || document.body;
}

/** 清除上一轮落点高亮 */
function clearDropHighlight(): void {
  document.querySelectorAll('.sb-empty-slot.drag-over, [data-sort-list].drag-over, .sb-child-area.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
  document.getElementById('sb-pool')?.classList.remove('remove-target');
}

/** 是否正在拖拽 */
export function isPointerDragging(): boolean {
  return !!(active && active.activated);
}

/** 拖拽激活后吞掉随后的 click（避免误触折叠） */
export function consumeSuppressNextClick(): boolean {
  if (!suppressNextClick) return false;
  suppressNextClick = false;
  return true;
}

/**
 * 在 pointerdown 时调用。未超过移动阈值前不激活 ghost，以保留单击折叠。
 */
export function beginPointerDrag(
  e: PointerEvent,
  session: PointerDragSession,
  handlers: PointerDragHandlers,
): void {
  if (e.button !== 0) return;
  if (active) teardown(true);

  const host = dragHost();
  const ghost = document.createElement('div');
  ghost.className = 'sb-drag-ghost';
  ghost.textContent = session.label;
  ghost.style.display = 'none';
  host.appendChild(ghost);

  const gap = document.createElement('div');
  gap.className = 'sb-drag-gap';
  gap.style.display = 'none';
  host.appendChild(gap);

  active = {
    session,
    handlers,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    activated: false,
    ghost,
    gap,
    lastHit: { action: 'invalid' },
    lastGapKey: '',
  };

  session.originEl.classList.add('sb-drag-pending');
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
}

function onPointerMove(e: PointerEvent): void {
  if (!active || e.pointerId !== active.pointerId) return;
  const dx = e.clientX - active.startX;
  const dy = e.clientY - active.startY;

  if (!active.activated) {
    if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    activateDrag(e);
  }

  e.preventDefault();
  moveGhost(e.clientX, e.clientY);
  const hit = resolveHit(e.clientX, e.clientY, active.session);
  active.lastHit = hit;
  updateGap(hit);
  updateDropHighlight(hit, e.clientX, e.clientY);
}

function activateDrag(e: PointerEvent): void {
  if (!active) return;
  active.activated = true;
  suppressNextClick = true;
  active.session.originEl.classList.remove('sb-drag-pending');
  active.session.originEl.classList.add('sb-dragging-source');
  active.ghost.style.display = '';
  moveGhost(e.clientX, e.clientY);
  document.body.classList.add('sb-pointer-dragging');
}

function onPointerUp(e: PointerEvent): void {
  if (!active || e.pointerId !== active.pointerId) return;
  if (!active.activated) {
    teardown(true);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const { session, handlers, lastHit } = active;
  const err = handlers.onCommit(session, lastHit);
  teardown(false);
  if (err) {
    const toast = document.getElementById('sb-toast');
    if (toast) {
      toast.textContent = err;
      (toast as HTMLElement).style.display = 'block';
      setTimeout(() => { (toast as HTMLElement).style.display = 'none'; }, 2000);
    }
  }
}

function onPointerCancel(e: PointerEvent): void {
  if (!active || e.pointerId !== active.pointerId) return;
  active.handlers.onCancel?.();
  teardown(true);
}

function teardown(cancelled: boolean): void {
  if (!active) return;
  const a = active;
  active = null;
  window.removeEventListener('pointermove', onPointerMove, true);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('pointercancel', onPointerCancel, true);
  a.session.originEl.classList.remove('sb-drag-pending', 'sb-dragging-source');
  document.body.classList.remove('sb-pointer-dragging');
  clearDropHighlight();
  a.ghost.remove();
  a.gap.remove();
  if (cancelled) {
    suppressNextClick = false;
    a.handlers.onCancel?.();
  }
}

function moveGhost(x: number, y: number): void {
  if (!active) return;
  active.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

/** 根据指针位置解析命中（纯 DOM 约定，无业务规则） */
export function resolveHit(x: number, y: number, session: PointerDragSession): PointerDragHit {
  const stack = document.elementsFromPoint(x, y) as HTMLElement[];
  const el = stack.find(n =>
    !n.classList.contains('sb-drag-ghost') && !n.classList.contains('sb-drag-gap'),
  ) || null;
  if (!el) return { action: 'invalid' };

  if (el.closest('#sb-pool')) {
    return session.source === 'bd' ? { action: 'remove' } : { action: 'invalid' };
  }

  const empty = el.closest('.sb-empty-slot') as HTMLElement | null;
  if (empty) {
    const dropzone = empty.dataset.dropzone as 'child' | 'affix' | undefined;
    const parentId = empty.dataset.instance || null;
    const side = empty.dataset.side as 'player' | 'enemy' | undefined;
    if (!side || !dropzone) return { action: 'invalid' };
    if (dropzone === 'affix' && session.kind !== 'affix') return { action: 'invalid' };
    if (dropzone === 'child' && session.kind !== 'entity') return { action: 'invalid' };
    return {
      action: 'mount',
      side,
      listKind: dropzone === 'affix' ? 'affix' : 'child',
      parentInstanceId: parentId,
      insertIndex: undefined,
    };
  }

  const list = el.closest('[data-sort-list]') as HTMLElement | null;
  if (!list) {
    const bd = el.closest('#sb-player-bd, #sb-enemy-bd') as HTMLElement | null;
    if (bd && session.kind === 'entity') {
      const side = bd.id === 'sb-player-bd' ? 'player' : 'enemy';
      return { action: 'mount', side, listKind: 'top', parentInstanceId: null, insertIndex: undefined };
    }
    return { action: 'invalid' };
  }

  const listKind = list.dataset.sortList as 'top' | 'child' | 'affix';
  const side = (list.dataset.side || session.side) as 'player' | 'enemy' | undefined;
  const accept = list.dataset.accept || 'entity';
  if (accept === 'entity' && session.kind !== 'entity') return { action: 'invalid' };
  if (accept === 'affix' && session.kind !== 'affix') return { action: 'invalid' };
  if (!side) return { action: 'invalid' };

  const parentInstanceId = listKind === 'top' ? null : (list.dataset.instance || null);
  const items = getSortItems(list, listKind);
  const insertIndex = computeInsertIndex(items, y);

  const sameListReorder = session.source === 'bd' && items.some(it => it.dataset.instance === session.id);
  return {
    action: sameListReorder ? 'reorder' : 'mount',
    side,
    listKind,
    parentInstanceId,
    insertIndex,
  };
}

function getSortItems(list: HTMLElement, listKind: string): HTMLElement[] {
  if (listKind === 'affix') {
    return Array.from(list.querySelectorAll(':scope > [data-sort-item="affix"]')) as HTMLElement[];
  }
  return Array.from(list.querySelectorAll(':scope > .sb-card[data-sort-item="entity"]')) as HTMLElement[];
}

function computeInsertIndex(items: HTMLElement[], clientY: number): number {
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return items.length;
}

function listSelector(hit: PointerDragHit): string | null {
  if (hit.listKind == null || hit.side == null) return null;
  if (hit.listKind === 'top') {
    return `[data-sort-list="top"][data-side="${hit.side}"]`;
  }
  return `[data-sort-list="${hit.listKind}"][data-instance="${hit.parentInstanceId}"][data-side="${hit.side}"]`;
}

function updateGap(hit: PointerDragHit): void {
  if (!active) return;
  const gap = active.gap;
  if ((hit.action !== 'reorder' && hit.action !== 'mount') || hit.listKind == null || hit.side == null) {
    gap.style.display = 'none';
    active.lastGapKey = '';
    return;
  }
  if (hit.insertIndex == null) {
    gap.style.display = 'none';
    active.lastGapKey = '';
    return;
  }

  const listSel = listSelector(hit);
  if (!listSel) {
    gap.style.display = 'none';
    return;
  }
  const list = document.querySelector(listSel) as HTMLElement | null;
  if (!list) {
    gap.style.display = 'none';
    return;
  }
  const items = getSortItems(list, hit.listKind);
  const key = `${listSel}:${hit.insertIndex}`;
  if (key === active.lastGapKey && gap.style.display !== 'none') return;
  active.lastGapKey = key;

  let top: number;
  let left: number;
  let width: number;
  if (items.length === 0 || hit.insertIndex >= items.length) {
    const lr = list.getBoundingClientRect();
    const last = items[items.length - 1];
    if (last) {
      const r = last.getBoundingClientRect();
      top = r.bottom;
      left = r.left;
      width = r.width;
    } else {
      top = lr.top + 8;
      left = lr.left + 8;
      width = Math.max(lr.width - 16, 40);
    }
  } else {
    const r = items[hit.insertIndex].getBoundingClientRect();
    top = r.top;
    left = r.left;
    width = r.width;
  }

  gap.style.display = '';
  gap.style.width = `${width}px`;
  gap.style.transform = `translate(${left}px, ${top - 2}px)`;
}

/** 空槽 / 排序列表 / 物品池落点高亮 */
function updateDropHighlight(hit: PointerDragHit, x: number, y: number): void {
  clearDropHighlight();

  if (hit.action === 'remove') {
    document.getElementById('sb-pool')?.classList.add('remove-target');
    return;
  }

  if (hit.action !== 'mount' && hit.action !== 'reorder') return;

  // 空槽 mount：按指针下元素挂 drag-over
  if (hit.action === 'mount' && hit.insertIndex == null) {
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    const under = stack.find(n =>
      !n.classList.contains('sb-drag-ghost') && !n.classList.contains('sb-drag-gap'),
    ) || null;
    const empty = under?.closest('.sb-empty-slot') as HTMLElement | null;
    if (empty) {
      empty.classList.add('drag-over');
      const childArea = empty.closest('.sb-child-area') as HTMLElement | null;
      childArea?.classList.add('drag-over');
      return;
    }
  }

  const listSel = listSelector(hit);
  if (!listSel) return;
  const list = document.querySelector(listSel) as HTMLElement | null;
  list?.classList.add('drag-over');
}
