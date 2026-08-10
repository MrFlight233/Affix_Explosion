// Worker 宿主：max 模式优先走 Worker 无头演算，失败则回退主线程 Simulator

import type { OnHitEffect } from '../data';
import {
  BattleSimulator,
  playBattle,
  onHitMapToPairs,
  type CombatEvent,
  type CombatUnitRuntime,
  type PlaybackSpeed,
} from './index';
import type { WorkerInMsg, WorkerOutMsg } from './battle.worker';

export interface WorkerBattleOpts {
  playerUnits: CombatUnitRuntime[];
  enemyUnits: CombatUnitRuntime[];
  playerOnHitEffects: Map<string, OnHitEffect[]>;
  enemyOnHitEffects: Map<string, OnHitEffect[]>;
  onEvent: (evt: CombatEvent) => void;
  onTick?: (combatTime: number, player: CombatUnitRuntime[], enemy: CombatUnitRuntime[]) => void;
  isPaused?: () => boolean;
  isCancelled?: () => boolean;
  speed: PlaybackSpeed | (() => PlaybackSpeed);
}

function resolveSpeed(speed: PlaybackSpeed | (() => PlaybackSpeed)): PlaybackSpeed {
  return typeof speed === 'function' ? speed() : speed;
}

export function createBattleWorker(): Worker {
  return new Worker(new URL('./battle.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * 运行战斗：1/2/4 主线程 Playback；max 尝试 Worker，失败回退主线程 max。
 */
export async function runBattleWithOptionalWorker(opts: WorkerBattleOpts): Promise<{ win: boolean }> {
  const spd = resolveSpeed(opts.speed);

  if (spd !== 'max') {
    const simulator = new BattleSimulator({
      playerUnits: opts.playerUnits,
      enemyUnits: opts.enemyUnits,
      playerOnHitEffects: opts.playerOnHitEffects,
      enemyOnHitEffects: opts.enemyOnHitEffects,
    });
    return playBattle({
      simulator,
      speed: opts.speed,
      onEvent: opts.onEvent,
      onTick: (sim) => opts.onTick?.(sim.combatTime, sim.playerUnits, sim.enemyUnits),
      isPaused: opts.isPaused,
      isCancelled: opts.isCancelled,
    });
  }

  try {
    return await runMaxViaWorker(opts);
  } catch (e) {
    console.warn('[battle] Worker 不可用，回退主线程', e);
    const simulator = new BattleSimulator({
      playerUnits: opts.playerUnits,
      enemyUnits: opts.enemyUnits,
      playerOnHitEffects: opts.playerOnHitEffects,
      enemyOnHitEffects: opts.enemyOnHitEffects,
    });
    return playBattle({
      simulator,
      speed: 'max',
      onEvent: opts.onEvent,
      onTick: (sim) => opts.onTick?.(sim.combatTime, sim.playerUnits, sim.enemyUnits),
      isPaused: opts.isPaused,
      isCancelled: opts.isCancelled,
    });
  }
}

function applyUnitState(dst: CombatUnitRuntime[], src: CombatUnitRuntime[]) {
  const map = new Map(src.map(u => [u.instanceId, u]));
  for (const u of dst) {
    const s = map.get(u.instanceId);
    if (!s) continue;
    u.currentHp = s.currentHp;
    u.currentStamina = s.currentStamina;
    u._prevTotalHp = s._prevTotalHp;
    u._prevMaxStamina = s._prevMaxStamina;
    for (let i = 0; i < u.weapons.length; i++) {
      if (s.weapons[i]) u.weapons[i].remainingTime = s.weapons[i].remainingTime;
    }
  }
}

function runMaxViaWorker(opts: WorkerBattleOpts): Promise<{ win: boolean }> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createBattleWorker();
    } catch (e) {
      reject(e);
      return;
    }

    const cancelPoll = setInterval(() => {
      if (opts.isCancelled?.()) {
        worker.postMessage({ type: 'cancel' } satisfies WorkerInMsg);
      }
    }, 50);

    const cleanup = () => {
      clearInterval(cancelPoll);
      worker.terminate();
    };

    worker.onmessage = (ev: MessageEvent<WorkerOutMsg>) => {
      const msg = ev.data;
      if (msg.type === 'batch') {
        for (const e of msg.events) opts.onEvent(e);
        opts.onTick?.(msg.combatTime, opts.playerUnits, opts.enemyUnits);
      } else if (msg.type === 'done') {
        if (msg.playerUnits && msg.enemyUnits) {
          applyUnitState(opts.playerUnits, msg.playerUnits);
          applyUnitState(opts.enemyUnits, msg.enemyUnits);
        }
        opts.onTick?.(msg.combatTime, opts.playerUnits, opts.enemyUnits);
        cleanup();
        resolve({ win: msg.win });
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(err);
    };

    worker.postMessage({
      type: 'init',
      payload: {
        playerUnits: structuredClone(opts.playerUnits),
        enemyUnits: structuredClone(opts.enemyUnits),
        playerOnHitEffects: onHitMapToPairs(opts.playerOnHitEffects),
        enemyOnHitEffects: onHitMapToPairs(opts.enemyOnHitEffects),
      },
    } satisfies WorkerInMsg);
    worker.postMessage({ type: 'runToEnd' } satisfies WorkerInMsg);
  });
}
