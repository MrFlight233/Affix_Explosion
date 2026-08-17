import { For, type Accessor } from 'solid-js';
import type { CombatEvent } from '../../game/engine';
import { formatCombatEventLogHtml } from '../../game/activeActionDisplay';

const LOG_CAP = 500;

export interface BattleLogProps {
  events: Accessor<CombatEvent[]>;
}

/** Solid 战斗日志 — 自动裁剪上限；HTML 含敌我着色 */
export function BattleLogPanel(props: BattleLogProps) {
  const blocks = () => {
    const all = props.events();
    const slice = all.length > LOG_CAP ? all.slice(all.length - LOG_CAP) : all;
    return slice.map((evt, i) => ({
      key: `${i}-${evt.time}-${evt.targetName}`,
      html: formatCombatEventLogHtml(evt),
    }));
  };

  return (
    <For each={blocks()}>
      {(block) => (
        <div class="sb-log-block" innerHTML={block.html} />
      )}
    </For>
  );
}

/** 供非 Solid 页面复用同一事件→HTML 规则 */
export { formatCombatEventLogHtml };
