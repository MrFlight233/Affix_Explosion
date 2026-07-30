// ============================================================
// 探险壳可调分界线 — 竖线（BD|右栏）+ 横线（情景|仓库）
// 战斗壳可调分界线 — 横线（友敌BD | 日志）
// ============================================================

export interface ExploreSplit {
  leftPct: number;
  topPct: number;
}

export interface CombatSplit {
  /** 日志区占主布局高度的百分比 */
  logPct: number;
}

export interface RunReviewSplit {
  /** 左侧场次列表占 body 宽度百分比 */
  listPct: number;
  /** 右侧详情内日志区占 detail-body 高度百分比 */
  logPct: number;
}

const STORAGE_KEY = 'fg-explore-split';
const COMBAT_STORAGE_KEY = 'fg-combat-split';
const RUN_REVIEW_STORAGE_KEY = 'fg-run-review-split';
const DEFAULT: ExploreSplit = { leftPct: 48, topPct: 55 };
const COMBAT_DEFAULT: CombatSplit = { logPct: 28 };
const RUN_REVIEW_DEFAULT: RunReviewSplit = { listPct: 26, logPct: 38 };

const LEFT_MIN_PX = 280;
const RIGHT_MIN_PX = 320;
const LEFT_MAX_PCT = 70;
const ROW_MIN_PX = 120;
const COMBAT_LOG_MIN_PX = 100;
const COMBAT_BD_MIN_PX = 120;
const COMBAT_LOG_MIN_PCT = 12;
const COMBAT_LOG_MAX_PCT = 55;
const RUN_LIST_MIN_PX = 160;
const RUN_DETAIL_MIN_PX = 280;
const RUN_LIST_MIN_PCT = 16;
const RUN_LIST_MAX_PCT = 45;
const RUN_LOG_MIN_PX = 80;
const RUN_BD_MIN_PX = 100;
const RUN_LOG_MIN_PCT = 18;
const RUN_LOG_MAX_PCT = 65;

let current: ExploreSplit = loadSplit();
let combatCurrent: CombatSplit = loadCombatSplit();
let runReviewCurrent: RunReviewSplit = loadRunReviewSplit();
let dragKind: 'v' | 'h' | 'combat-h' | 'run-v' | 'run-h' | null = null;
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

export function loadCombatSplit(): CombatSplit {
  try {
    const raw = localStorage.getItem(COMBAT_STORAGE_KEY);
    if (!raw) return { ...COMBAT_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<CombatSplit>;
    const logPct = Number(parsed.logPct);
    if (!Number.isFinite(logPct)) return { ...COMBAT_DEFAULT };
    return { logPct: clamp(logPct, COMBAT_LOG_MIN_PCT, COMBAT_LOG_MAX_PCT) };
  } catch {
    return { ...COMBAT_DEFAULT };
  }
}

export function saveCombatSplit(s: CombatSplit) {
  try {
    localStorage.setItem(COMBAT_STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore quota */ }
}

export function applyCombatSplit(layout: HTMLElement, split: CombatSplit = combatCurrent) {
  combatCurrent = split;
  layout.style.setProperty('--fg-combat-log-pct', `${split.logPct}%`);
}

export function loadRunReviewSplit(): RunReviewSplit {
  try {
    const raw = localStorage.getItem(RUN_REVIEW_STORAGE_KEY);
    if (!raw) return { ...RUN_REVIEW_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<RunReviewSplit>;
    const listPct = Number(parsed.listPct);
    const logPct = Number(parsed.logPct);
    if (!Number.isFinite(listPct) || !Number.isFinite(logPct)) return { ...RUN_REVIEW_DEFAULT };
    return {
      listPct: clamp(listPct, RUN_LIST_MIN_PCT, RUN_LIST_MAX_PCT),
      logPct: clamp(logPct, RUN_LOG_MIN_PCT, RUN_LOG_MAX_PCT),
    };
  } catch {
    return { ...RUN_REVIEW_DEFAULT };
  }
}

export function saveRunReviewSplit(s: RunReviewSplit) {
  try {
    localStorage.setItem(RUN_REVIEW_STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore quota */ }
}

export function applyRunReviewSplit(layout: HTMLElement, split: RunReviewSplit = runReviewCurrent) {
  runReviewCurrent = split;
  layout.style.setProperty('--fg-run-list-pct', `${split.listPct}%`);
  layout.style.setProperty('--fg-run-log-pct', `${split.logPct}%`);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * 绑定竖/横分界线（按 layout 节点幂等）。
 * 物品拖拽进行中（.dragging）不进入 resize。
 * 含战斗壳上下分界线 `#combat-h-split`。
 */
export function bindSplitters(layout: HTMLElement) {
  current = loadSplit();
  combatCurrent = loadCombatSplit();
  applySplit(layout, current);
  applyCombatSplit(layout, combatCurrent);
  if (layout.dataset.splitBound === '1') return;
  layout.dataset.splitBound = '1';

  const vSplit = layout.querySelector('#v-split') as HTMLElement | null;
  const hSplit = layout.querySelector('#h-split') as HTMLElement | null;
  const combatHSplit = layout.querySelector('#combat-h-split') as HTMLElement | null;
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
    } else if (dragKind === 'h') {
      const right = activeLayout.querySelector('#right-zone') as HTMLElement | null;
      if (!right) return;
      const rect = right.getBoundingClientRect();
      const height = rect.height;
      if (height <= 0) return;
      let topPx = e.clientY - rect.top;
      topPx = clamp(topPx, ROW_MIN_PX, Math.max(ROW_MIN_PX, height - ROW_MIN_PX));
      current = { ...current, topPct: (topPx / height) * 100 };
      applySplit(activeLayout, current);
    } else if (dragKind === 'combat-h') {
      const rect = activeLayout.getBoundingClientRect();
      const height = rect.height;
      if (height <= 0) return;
      // 光标以下为日志区高度
      let logPx = rect.bottom - e.clientY;
      logPx = clamp(logPx, COMBAT_LOG_MIN_PX, Math.max(COMBAT_LOG_MIN_PX, height - COMBAT_BD_MIN_PX));
      let logPct = (logPx / height) * 100;
      logPct = clamp(logPct, COMBAT_LOG_MIN_PCT, COMBAT_LOG_MAX_PCT);
      combatCurrent = { logPct };
      applyCombatSplit(activeLayout, combatCurrent);
    }
  };

  const endDrag = () => {
    if (!dragKind) return;
    const kind = dragKind;
    dragKind = null;
    activeLayout = null;
    document.body.classList.remove('fg-resizing-col', 'fg-resizing-row');
    if (kind === 'combat-h') saveCombatSplit(combatCurrent);
    else saveSplit(current);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', endDrag);
  };

  const start = (kind: 'v' | 'h' | 'combat-h') => (e: MouseEvent) => {
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
  if (combatHSplit) combatHSplit.addEventListener('mousedown', start('combat-h'));
}

/**
 * 结算/历史回顾三分区可调分界线（按 layout 幂等）。
 * 竖线：场次列表 | 详情；横线：双方 BD | 战斗日志。
 */
export function bindRunReviewSplitters(layout: HTMLElement) {
  runReviewCurrent = loadRunReviewSplit();
  applyRunReviewSplit(layout, runReviewCurrent);
  if (layout.dataset.runSplitBound === '1') return;
  layout.dataset.runSplitBound = '1';

  const onMove = (e: MouseEvent) => {
    if (!dragKind || !activeLayout) return;
    if (dragKind === 'run-v') {
      const body = activeLayout.querySelector('.fg-run-body') as HTMLElement | null;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return;
      let listPx = e.clientX - rect.left;
      listPx = clamp(listPx, RUN_LIST_MIN_PX, Math.max(RUN_LIST_MIN_PX, width - RUN_DETAIL_MIN_PX));
      let listPct = (listPx / width) * 100;
      listPct = clamp(listPct, RUN_LIST_MIN_PCT, RUN_LIST_MAX_PCT);
      if (width - (listPct / 100) * width < RUN_DETAIL_MIN_PX) {
        listPct = ((width - RUN_DETAIL_MIN_PX) / width) * 100;
      }
      runReviewCurrent = { ...runReviewCurrent, listPct };
      applyRunReviewSplit(activeLayout, runReviewCurrent);
    } else if (dragKind === 'run-h') {
      const detailBody = activeLayout.querySelector('.fg-run-detail-body') as HTMLElement | null;
      if (!detailBody) return;
      const rect = detailBody.getBoundingClientRect();
      const height = rect.height;
      if (height <= 0) return;
      let logPx = rect.bottom - e.clientY;
      logPx = clamp(logPx, RUN_LOG_MIN_PX, Math.max(RUN_LOG_MIN_PX, height - RUN_BD_MIN_PX));
      let logPct = (logPx / height) * 100;
      logPct = clamp(logPct, RUN_LOG_MIN_PCT, RUN_LOG_MAX_PCT);
      runReviewCurrent = { ...runReviewCurrent, logPct };
      applyRunReviewSplit(activeLayout, runReviewCurrent);
    }
  };

  const endDrag = () => {
    if (dragKind !== 'run-v' && dragKind !== 'run-h') return;
    dragKind = null;
    activeLayout = null;
    document.body.classList.remove('fg-resizing-col', 'fg-resizing-row');
    saveRunReviewSplit(runReviewCurrent);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', endDrag);
  };

  const start = (kind: 'run-v' | 'run-h') => (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragKind = kind;
    activeLayout = layout;
    document.body.classList.add(kind === 'run-v' ? 'fg-resizing-col' : 'fg-resizing-row');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
  };

  // 横线在换场时会重建 DOM，用委托绑定
  layout.addEventListener('mousedown', (e) => {
    const t = (e.target as HTMLElement).closest('#fg-run-v-split, #fg-run-h-split') as HTMLElement | null;
    if (!t || !layout.contains(t)) return;
    if (t.id === 'fg-run-v-split') start('run-v')(e);
    else if (t.id === 'fg-run-h-split') start('run-h')(e);
  });
}
