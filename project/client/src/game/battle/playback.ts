// Playback：按倍速消费 Simulator 步进，与演算解耦

import type { CombatEvent } from './types';
import { TICK_MS, type PlaybackSpeed } from './types';
import type { BattleSimulator } from './simulator';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface PlaybackOptions {
  simulator: BattleSimulator;
  /** 静态倍速或运行时 getter */
  speed: PlaybackSpeed | (() => PlaybackSpeed);
  onEvent: (evt: CombatEvent) => void;
  /** 每逻辑 tick 后回调（供 UI 同步 combatTime / units） */
  onTick?: (sim: BattleSimulator) => void;
  isPaused?: () => boolean;
  isCancelled?: () => boolean;
}

function resolveSpeed(speed: PlaybackSpeed | (() => PlaybackSpeed)): PlaybackSpeed {
  return typeof speed === 'function' ? speed() : speed;
}

/**
 * 驱动 Simulator 播放。
 * - 1/2/4：每逻辑 tick 等待 TICK_MS/speed 墙钟后 step
 * - max：批量 step（每批 50 tick yield 一次），近即时跑完
 */
export async function playBattle(opts: PlaybackOptions): Promise<{ win: boolean }> {
  const { simulator, onEvent, onTick, isPaused, isCancelled } = opts;

  const flush = () => {
    for (const evt of simulator.drainEvents()) onEvent(evt);
  };

  while (!simulator.isFinished) {
    if (isCancelled?.()) break;

    while (isPaused?.()) {
      if (isCancelled?.()) break;
      await delay(50);
    }
    if (isCancelled?.()) break;

    const spd = resolveSpeed(opts.speed);

    if (spd === 'max') {
      const done = simulator.stepN(50);
      flush();
      onTick?.(simulator);
      if (!done) await delay(0);
      continue;
    }

    const waitMs = Math.max(TICK_MS / spd, 1);
    await delay(waitMs);
    if (isCancelled?.()) break;
    // 暂停期间不推进（上面已处理）；若在 wait 中被暂停，下一轮再检查
    if (isPaused?.()) continue;

    simulator.step();
    flush();
    onTick?.(simulator);
  }

  flush();
  onTick?.(simulator);
  return { win: simulator.resultWin };
}

/**
 * 无头：立刻 runToEnd，可选把全部事件回调出去。
 */
export function runBattleHeadless(
  simulator: BattleSimulator,
  onEvent?: (evt: CombatEvent) => void,
): { win: boolean; combatTime: number; events: CombatEvent[] } {
  const { win, combatTime } = simulator.runToEnd();
  const events = simulator.drainEvents();
  if (onEvent) for (const e of events) onEvent(e);
  return { win, combatTime, events };
}
