/// <reference lib="webworker" />
// 战斗演算 Worker — 接收 init + runToEnd，回传事件批次与结果

import {
  BattleSimulator,
  type BattleInitPayload,
  type CombatEvent,
  onHitPairsToMap,
} from './index';

export type WorkerInMsg =
  | { type: 'init'; payload: BattleInitPayload }
  | { type: 'runToEnd' }
  | { type: 'cancel' };

export type WorkerOutMsg =
  | { type: 'batch'; events: CombatEvent[]; combatTime: number }
  | {
      type: 'done';
      win: boolean;
      combatTime: number;
      playerUnits?: import('./types').CombatUnitRuntime[];
      enemyUnits?: import('./types').CombatUnitRuntime[];
    }
  | { type: 'error'; message: string };

let simulator: BattleSimulator | null = null;
let cancelled = false;

self.onmessage = (ev: MessageEvent<WorkerInMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'cancel') {
      cancelled = true;
      return;
    }
    if (msg.type === 'init') {
      cancelled = false;
      const p = msg.payload;
      simulator = new BattleSimulator({
        playerUnits: p.playerUnits,
        enemyUnits: p.enemyUnits,
        playerOnHitEffects: onHitPairsToMap(p.playerOnHitEffects),
        enemyOnHitEffects: onHitPairsToMap(p.enemyOnHitEffects),
      });
      return;
    }
    if (msg.type === 'runToEnd') {
      if (!simulator) {
        post({ type: 'error', message: 'simulator not initialized' });
        return;
      }
      cancelled = false;
      // 分批步进，便于 cancel
      while (!simulator.isFinished) {
        if (cancelled) break;
        simulator.stepN(100);
        const events = simulator.drainEvents();
        if (events.length > 0) {
          post({ type: 'batch', events, combatTime: simulator.combatTime });
        }
      }
      post({
        type: 'done',
        win: simulator.resultWin,
        combatTime: simulator.combatTime,
        playerUnits: simulator.playerUnits,
        enemyUnits: simulator.enemyUnits,
      });
    }
  } catch (e: any) {
    post({ type: 'error', message: e?.message || String(e) });
  }
};

function post(msg: WorkerOutMsg) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}
