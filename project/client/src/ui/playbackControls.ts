// 共用战斗播放控制（倍速 + 暂停）

import type { PlaybackSpeed } from '../game/engine';

export interface PlaybackControlState {
  speed: PlaybackSpeed;
  paused: boolean;
}

export interface BindPlaybackControlsOpts {
  /** 控件容器根节点（其内需有 data-speed / #…-pause） */
  root: ParentNode;
  getState: () => PlaybackControlState;
  setSpeed: (speed: PlaybackSpeed) => void;
  setPaused: (paused: boolean) => void;
  /** 暂停按钮 id，默认 cp-btn-pause */
  pauseBtnId?: string;
  /** 状态变化后可选重绘控件区 */
  onChange?: () => void;
}

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 'max'];

/** 生成倍速+暂停按钮 HTML */
export function renderPlaybackControlsHtml(state: PlaybackControlState, pauseBtnId = 'cp-btn-pause'): string {
  const speedBtns = SPEEDS.map(s => {
    const label = s === 'max' ? 'Max' : `${s}x`;
    const active = state.speed === s ? ' active' : '';
    return `<button type="button" class="sb-speed-btn${active}" data-speed="${s}">${label}</button>`;
  }).join('');
  return `
    <span class="sb-speed-group">${speedBtns}</span>
    <button type="button" class="sb-speed-btn${state.paused ? ' paused' : ''}" id="${pauseBtnId}">${state.paused ? '已暂停' : '暂停'}</button>
  `;
}

/** 在 root 上委托绑定倍速/暂停点击 */
export function bindPlaybackControls(opts: BindPlaybackControlsOpts): void {
  const pauseId = opts.pauseBtnId ?? 'cp-btn-pause';
  opts.root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const speedBtn = target.closest('[data-speed]') as HTMLElement | null;
    const pauseBtn = target.closest(`#${pauseId}`);
    if (speedBtn?.dataset.speed) {
      const raw = speedBtn.dataset.speed;
      const spd: PlaybackSpeed = raw === 'max' ? 'max' : (Number(raw) as 1 | 2 | 4);
      opts.setSpeed(spd);
      opts.onChange?.();
      return;
    }
    if (pauseBtn) {
      const st = opts.getState();
      opts.setPaused(!st.paused);
      opts.onChange?.();
    }
  });
}
