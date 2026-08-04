import { For, type Accessor } from 'solid-js';
import type { CombatEvent } from '../../game/engine';
import {
  formatCombatEventLogHtml,
  formatCombatKillLine,
  formatCombatLogHeader,
} from '../../game/activeActionDisplay';

const LOG_CAP = 500;

export interface BattleLogProps {
  events: Accessor<CombatEvent[]>;
}

interface LogRow {
  key: string;
  className: string;
  text: string;
  indent?: string;
}

function toRows(events: CombatEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.effects.includes('击杀')) {
      rows.push({
        key: `${i}-kill`,
        className: 'sb-log-entry kill',
        text: formatCombatKillLine(evt.time, evt.targetName),
      });
      continue;
    }
    if (evt.targetName === '战斗开始') {
      rows.push({ key: `${i}-start`, className: 'sb-log-entry', text: '[0.0s] 战斗开始' });
      continue;
    }
    if (evt.targetName === '超时惩罚') {
      rows.push({
        key: `${i}-ot`,
        className: 'sb-log-entry',
        text: `[${(evt.time / 1000).toFixed(1)}s] 超时惩罚 ${evt.effects[0] || ''}`,
      });
      continue;
    }
    if (!evt.actorName && !evt.weaponName) {
      // 持续 Tick 等：有子行则显示时间戳 + 效果；否则仅显示目标名
      if (evt.effects?.length) {
        rows.push({
          key: `${i}-tick-t`,
          className: 'sb-log-entry',
          text: `[${(evt.time / 1000).toFixed(1)}s]`,
        });
        for (let j = 0; j < evt.effects.length; j++) {
          const eff = evt.effects[j];
          if (eff === '击杀') continue;
          rows.push({
            key: `${i}-tick-e${j}`,
            className: 'sb-log-entry',
            text: eff,
            indent: '20px',
          });
        }
      } else {
        rows.push({
          key: `${i}-misc`,
          className: 'sb-log-entry',
          text: `[${(evt.time / 1000).toFixed(1)}s] ${evt.targetName}`,
        });
      }
      continue;
    }
    rows.push({
      key: `${i}-main`,
      className: 'sb-log-entry',
      text: formatCombatLogHeader(evt),
    });
    for (let j = 0; j < evt.effects.length; j++) {
      const eff = evt.effects[j];
      if (eff !== '击杀') {
        rows.push({ key: `${i}-e${j}`, className: 'sb-log-entry', text: eff, indent: '20px' });
      }
    }
  }
  return rows;
}

/** Solid 战斗日志 — 自动裁剪上限，避免 DOM 膨胀 */
export function BattleLogPanel(props: BattleLogProps) {
  const rows = () => {
    const all = props.events();
    const slice = all.length > LOG_CAP ? all.slice(all.length - LOG_CAP) : all;
    return toRows(slice);
  };

  return (
    <For each={rows()}>
      {(row) => (
        <div class={row.className} style={row.indent ? { 'padding-left': row.indent } : undefined}>
          {row.text}
        </div>
      )}
    </For>
  );
}

/** 供非 Solid 页面复用同一事件→HTML 规则 */
export { formatCombatEventLogHtml };
