import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { BattleLogPanel } from './BattleLogPanel';
import type { CombatEvent } from '../../game/engine';

export interface BattleLogBridge {
  setEvents: (events: CombatEvent[]) => void;
  pushEvent: (evt: CombatEvent) => void;
  dispose: () => void;
}

/** 挂载 Solid 战斗日志到容器 */
export function mountBattleLog(container: HTMLElement): BattleLogBridge {
  const [events, setEvents] = createSignal<CombatEvent[]>([]);
  const dispose = render(() => <BattleLogPanel events={events} />, container);

  return {
    setEvents: (evts: CombatEvent[]) => setEvents(evts.slice()),
    pushEvent: (evt: CombatEvent) => setEvents(prev => [...prev, evt]),
    dispose: () => {
      dispose();
      container.replaceChildren();
    },
  };
}
