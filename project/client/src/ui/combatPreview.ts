// 共用战斗预览面板（正式战 / 模拟战）

import type { CombatUnitSnapshot } from '../game/engine';
import type { TargetCondition } from '../game/data';

export interface CombatPreviewWeapon {
  name: string;
  targetFaction: string;
  targetCondition?: TargetCondition;
  priorityTarget: number | null;
  targetOrder: string;
}

export interface ShowCombatPreviewOptions {
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  playerLabel?: string;
  enemyLabel?: string;
  playerSnaps: CombatUnitSnapshot[];
  enemySnaps: CombatUnitSnapshot[];
  /** 敌方为空时的提示文案 */
  emptyEnemyHint?: string;
  emptyPlayerHint?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

/** targeting 描述（与 panels / sim-battle 原逻辑一致） */
export function describeTargeting(w: CombatPreviewWeapon): string {
  const tc = w.targetCondition;
  let rule = '';
  if (tc?.sortBy === 'hp_asc') rule = 'HP最低优先';
  else if (tc?.sortBy === 'hp_desc') rule = 'HP最高优先';
  else if (tc?.sortBy === 'stamina_asc') rule = '耐力最低优先';
  else if (tc?.sortBy === 'random') rule = '随机';
  else if (w.priorityTarget !== null) rule = `前排优先${w.priorityTarget}`;
  else if (w.targetOrder === '从下往上') rule = '从后往前';
  else rule = '从上往下';

  if (tc?.filterBy) {
    const fbMap: Record<string, string> = {
      has_debuff: '有debuff',
      most_buffs: 'Buff最多',
      hp_below_50pct: 'HP<50%',
    };
    rule += ` + ${fbMap[tc.filterBy] || tc.filterBy}`;
  }
  return `${rule} → ${w.targetFaction}`;
}

function buildUnitCard(u: CombatUnitSnapshot, side: 'player' | 'enemy'): string {
  const cls = side === 'player' ? 'cp-player' : 'cp-enemy';
  let h = `<div class="cp-unit ${cls}">`;
  h += `<div class="cp-unit-name">${u.entityName}</div>`;
  h += `<div class="cp-unit-meta">HP:${u.currentHp}/${u.totalHp} 耐力:${u.currentStamina}/${u.maxStamina}</div>`;
  if (u.activeWeapons.length === 0) {
    h += `<div class="cp-weapon empty">（无可触发动作）</div>`;
  } else {
    for (const w of u.activeWeapons) {
      h += `<div class="cp-weapon">→ ${w.name} <span class="cp-targeting">${describeTargeting(w)}</span></div>`;
    }
  }
  h += `</div>`;
  return h;
}

/** 展示全屏战斗预览；确认/取消后自动关闭 */
export function showCombatPreview(opts: ShowCombatPreviewOptions): void {
  const title = opts.title ?? '⚔ 战斗预览';
  const subtitle = opts.subtitle ?? '确认双方对阵信息后开始战斗';
  const confirmLabel = opts.confirmLabel ?? '开始战斗';
  const playerLabel = opts.playerLabel ?? '【己方】';
  const enemyLabel = opts.enemyLabel ?? '【敌方】';
  const emptyPlayer = opts.emptyPlayerHint ?? '暂无上场单位';
  const emptyEnemy = opts.emptyEnemyHint ?? '暂无上场单位';

  let html = '<div id="combat-preview-overlay">';
  html += '<div id="combat-preview">';
  html += '<div id="cp-header">';
  html += `<div class="cp-title">${title}</div>`;
  html += `<div class="cp-subtitle">${subtitle}</div>`;
  html += '</div>';
  html += '<div id="cp-body">';
  html += '<div id="cp-player-col">';
  html += `<div class="cp-col-title">${playerLabel}</div>`;
  if (opts.playerSnaps.length === 0) html += `<div class="cp-empty">${emptyPlayer}</div>`;
  else for (const u of opts.playerSnaps) html += buildUnitCard(u, 'player');
  html += '</div>';
  html += '<div id="cp-vs">VS</div>';
  html += '<div id="cp-enemy-col">';
  html += `<div class="cp-col-title">${enemyLabel}</div>`;
  if (opts.enemySnaps.length === 0) html += `<div class="cp-empty">${emptyEnemy}</div>`;
  else for (const u of opts.enemySnaps) html += buildUnitCard(u, 'enemy');
  html += '</div></div>';
  html += '<div id="cp-footer">';
  html += `<button id="cp-btn-start">${confirmLabel}</button>`;
  html += '<button id="cp-btn-cancel" class="btn-secondary">取消</button>';
  html += '</div></div></div>';

  const app = document.getElementById('app')!;
  document.getElementById('combat-preview-overlay')?.remove();
  document.getElementById('sb-combat-preview-overlay')?.remove();
  app.insertAdjacentHTML('beforeend', html);

  const close = () => document.getElementById('combat-preview-overlay')?.remove();

  document.getElementById('cp-btn-start')!.onclick = () => {
    close();
    opts.onConfirm();
  };
  document.getElementById('cp-btn-cancel')!.onclick = () => {
    close();
    opts.onCancel?.();
  };
  document.getElementById('combat-preview-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'combat-preview-overlay') {
      close();
      opts.onCancel?.();
    }
  });
}
