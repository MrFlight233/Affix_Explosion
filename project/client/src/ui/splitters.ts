// ============================================================
// 探险壳可调分界线 — 竖线（BD|右栏）+ 横线（情景|仓库）
// ============================================================

export interface ExploreSplit {
  leftPct: number;
  topPct: number;
}

const STORAGE_KEY = 'fg-explore-split';
const DEFAULT: ExploreSplit = { leftPct: 48, topPct: 55 };

const LEFT_MIN_PX = 280;
const RIGHT_MIN_PX = 320;
const LEFT_MAX_PCT = 70;
const ROW_MIN_PX = 120;

let current: ExploreSplit = loadSplit();
let dragKind: 'v' | 'h' | null = null;
let activeLayout: HTMLElement | null = null;

export function loadSplit(): ExploreSplit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<ExploreSplit>;
    const leftPct = Number(parsed.leftPct);
    const topPct = Number(parsed.topPct);
    if (!Number.isFinite(leftPct) || !Number.isFinite(topPct)) return { ...DEFAULT };
    return {
      leftPct: clamp(leftPct, 20, LEFT_MAX_PCT),
      topPct: clamp(topPct, 20, 80),
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveSplit(s: ExploreSplit) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore quota */ }
}

export function applySplit(layout: HTMLElement, split: ExploreSplit = current) {
  layout.style.setProperty('--fg-left-pct', `${split.leftPct}%`);
  layout.style.setProperty('--fg-top-pct', `${split.topPct}%`);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * 绑定竖/横分界线（按 layout 节点幂等）。
 * 物品拖拽进行中（.dragging）不进入 resize。
 */
export function bindSplitters(layout: HTMLElement) {
  current = loadSplit();
  applySplit(layout, current);
  if (layout.dataset.splitBound === '1') return;
  layout.dataset.splitBound = '1';

  const vSplit = layout.querySelector('#v-split') as HTMLElement | null;
  const hSplit = layout.querySelector('#h-split') as HTMLElement | null;
  if (!vSplit || !hSplit) return;

  const onMove = (e: MouseEvent) => {
    if (!dragKind || !activeLayout) return;
    if (document.querySelector('.dragging')) {
      endDrag();
      return;
    }
    if (dragKind === 'v') {
      const rect = activeLayout.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return;
      let leftPx = e.clientX - rect.left;
      leftPx = clamp(leftPx, LEFT_MIN_PX, Math.max(LEFT_MIN_PX, width - RIGHT_MIN_PX));
      let leftPct = (leftPx / width) * 100;
      leftPct = clamp(leftPct, 20, LEFT_MAX_PCT);
      if (width - (leftPct / 100) * width < RIGHT_MIN_PX) {
        leftPct = ((width - RIGHT_MIN_PX) / width) * 100;
      }
      current = { ...current, leftPct };
      applySplit(activeLayout, current);
    } else {
      const right = activeLayout.querySelector('#right-zone') as HTMLElement | null;
      if (!right) return;
      const rect = right.getBoundingClientRect();
      const height = rect.height;
      if (height <= 0) return;
      let topPx = e.clientY - rect.top;
      topPx = clamp(topPx, ROW_MIN_PX, Math.max(ROW_MIN_PX, height - ROW_MIN_PX));
      current = { ...current, topPct: (topPx / height) * 100 };
      applySplit(activeLayout, current);
    }
  };

  const endDrag = () => {
    if (!dragKind) return;
    dragKind = null;
    activeLayout = null;
    document.body.classList.remove('fg-resizing-col', 'fg-resizing-row');
    saveSplit(current);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', endDrag);
  };

  const start = (kind: 'v' | 'h') => (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (document.querySelector('.dragging')) return;
    e.preventDefault();
    dragKind = kind;
    activeLayout = layout;
    document.body.classList.add(kind === 'v' ? 'fg-resizing-col' : 'fg-resizing-row');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
  };

  vSplit.addEventListener('mousedown', start('v'));
  hSplit.addEventListener('mousedown', start('h'));
}
