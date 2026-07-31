// ============================================================
// 玩家侧 Toast（正式局 #toast / 模拟战 #sb-toast）
// ============================================================

export type ToastHost = 'toast' | 'sb-toast';

const DEFAULT_MS = 2200;
const LONG_MS = 3000;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 长文案或前置/卸下校验提示多停一会儿 */
function resolveDuration(msg: string, override?: number): number {
  if (override != null) return override;
  if (msg.length >= 18 || /需要前置|不可移除/.test(msg)) return LONG_MS;
  return DEFAULT_MS;
}

function ensureToastEl(): HTMLElement {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  return el;
}

/** 优先指定 host；未指定时模拟战页有 #sb-toast 则用之，否则 #toast */
function resolveHost(preferred?: ToastHost): HTMLElement {
  if (preferred === 'sb-toast') {
    const sb = document.getElementById('sb-toast');
    if (sb) return sb;
    return ensureToastEl();
  }
  if (preferred === 'toast') return ensureToastEl();
  const sb = document.getElementById('sb-toast');
  if (sb) return sb;
  return ensureToastEl();
}

/**
 * 显示玩家侧提示（顶栏下方居中）。
 * Admin 的 #adm-toast 不走此函数。
 */
export function showAppToast(msg: string, opts?: { host?: ToastHost; durationMs?: number }): void {
  const el = resolveHost(opts?.host);
  el.textContent = msg;
  el.style.display = '';
  el.classList.remove('sb-toast-out');
  el.classList.add('show', 'sb-toast-visible');
  if (toastTimer) clearTimeout(toastTimer);
  const ms = resolveDuration(msg, opts?.durationMs);
  toastTimer = setTimeout(() => {
    el.classList.remove('show', 'sb-toast-visible');
    el.classList.add('sb-toast-out');
  }, ms);
}
