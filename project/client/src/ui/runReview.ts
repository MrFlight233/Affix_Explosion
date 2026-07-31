// ============================================================
// 通关结算 / 历史回顾 — 三分区：上统计 / 左场次列表 / 右详情
// ============================================================

import { BattleRecord, CombatEvent } from '../game/engine';
import { DeploySlot, ItemInstance } from '../game/data';
import { renderEntityCard } from './build/entityCard';
import { createCollapseState, collapseItemTree, CollapseState } from './build/types';
import { bindSbTooltips } from './build/simTooltip';
import { bindRunReviewSplitters } from './splitters';

function collectInstancesFromSlots(
  slots: DeploySlot[] | null | undefined,
  map: Map<string, ItemInstance>,
): void {
  if (!slots) return;
  const visit = (item: ItemInstance) => {
    map.set(item.instanceId, item);
    for (const c of item.children || []) visit(c);
  };
  for (const slot of slots) {
    visit(slot.entity);
    for (const c of slot.children || []) visit(c);
  }
}

function instanceLookupForBattle(b: BattleRecord): (id: string) => ItemInstance | null {
  const map = new Map<string, ItemInstance>();
  collectInstancesFromSlots(b.playerBd, map);
  collectInstancesFromSlots(b.enemyBd, map);
  return (id: string) => map.get(id) ?? null;
}

function resultLabel(r: BattleRecord['result']): string {
  if (r === 'auto_win') return '空池自动胜';
  if (r === 'win') return '胜利';
  return '失败';
}

function resultClass(r: BattleRecord['result']): string {
  if (r === 'loss') return 'fg-run-loss';
  if (r === 'auto_win') return 'fg-run-auto';
  return 'fg-run-win';
}

export function countWinsLosses(battles: BattleRecord[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const b of battles) {
    if (b.result === 'win' || b.result === 'auto_win') wins++;
    else if (b.result === 'loss') losses++;
  }
  return { wins, losses };
}

function formatLogHtml(log: CombatEvent[]): string {
  if (!log?.length) return '<div class="sb-log-entry" style="color:var(--fg-text-muted);">无日志</div>';
  let h = '';
  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    if (evt.effects?.includes('击杀')) {
      h += `<div class="sb-log-entry kill">[${(evt.time / 1000).toFixed(1)}s] ${evt.targetName} 击杀!</div>`;
      continue;
    }
    if (evt.targetName === '战斗开始') {
      h += `<div class="sb-log-entry">[0.0s] 战斗开始</div>`;
      continue;
    }
    if (evt.effects?.includes('空池自动获胜') || evt.targetName === '玩家胜利') {
      h += `<div class="sb-log-entry">[0.0s] 对战池无对手 · 自动获胜</div>`;
      continue;
    }
    h += `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s] ${evt.actorName} · ${evt.weaponName} -> ${evt.targetName} 伤害 ${evt.damage} (HP:${Math.round(evt.targetHpAfter)}/${evt.targetMaxHp})</div>`;
    for (const eff of evt.effects || []) {
      if (eff !== '击杀') h += `<div class="sb-log-entry" style="padding-left:20px">${eff}</div>`;
    }
  }
  return h;
}

function renderSideBd(
  slots: DeploySlot[] | null | undefined,
  collapse: CollapseState,
  emptyHint: string,
  side: 'player' | 'enemy' = 'player',
): string {
  if (!slots || slots.length === 0) {
    return `<div class="fg-run-bd-empty">${emptyHint}</div>`;
  }
  let h = '';
  for (const slot of slots) {
    collapseItemTree(slot.entity, collapse);
    h += renderEntityCard(slot.entity, 0, side, 'build', collapse);
  }
  return h;
}

/** 右侧：单场详情（双方 BD + 可拖横线 + 日志） */
export function renderBattleDetailHtml(b: BattleRecord): string {
  const collapse = createCollapseState();
  const opp = b.enemyBd == null ? '无对手' : (b.opponentName || '对手');
  const dur = b.durationMs != null ? ` · 时长 ${(b.durationMs / 1000).toFixed(1)}s` : '';
  let h = '<div class="fg-run-expand">';
  h += `<div class="fg-run-result-bar">结果：${resultLabel(b.result)} · 本场 +${b.rewardGold} 金 · ${opp}${dur}</div>`;
  h += '<div class="fg-run-detail-body">';
  h += '<div class="fg-run-bd-stack"><div class="fg-run-bd-row">';
  h += `<div class="fg-run-bd-col"><div class="fg-run-bd-title">我方 BD</div>${renderSideBd(b.playerBd, collapse, '（空）', 'player')}</div>`;
  h += `<div class="fg-run-bd-col"><div class="fg-run-bd-title">敌方 BD</div>${
    b.enemyBd == null
      ? '<div class="fg-run-bd-empty">对战池无对手 · 自动获胜</div>'
      : renderSideBd(b.enemyBd, collapse, '（空）', 'enemy')
  }</div>`;
  h += '</div></div>';
  h += '<div id="fg-run-h-split" class="fg-split-h" title="拖动调整日志高度"></div>';
  h += '<div class="fg-run-log-stack">';
  h += '<div class="fg-run-log-title">战斗日志</div>';
  h += `<div class="fg-run-log">${formatLogHtml(b.log || [])}</div>`;
  h += '</div></div></div>';
  return h;
}

function battleListRow(b: BattleRecord, idx: number, selected: boolean): string {
  const opp = b.enemyBd == null ? '无对手' : (b.opponentName || '对手');
  return `<button type="button" class="fg-run-list-item ${resultClass(b.result)}${selected ? ' is-selected' : ''}" data-select-battle="${idx}">
    <span class="fg-run-list-main">回合 ${b.round} · ${resultLabel(b.result)}</span>
    <span class="fg-run-list-meta">+${b.rewardGold} 金 · ${opp}</span>
  </button>`;
}

export interface RunReviewHeaderOpts {
  title: string;
  subtitle?: string;
  statusBadge?: 'in_progress' | 'cleared';
  wins: number;
  losses: number;
  gold?: number;
  maxRound?: number;
  showGold?: boolean;
  /** 顶栏左侧额外 HTML（如返回列表） */
  leadingHtml?: string;
  /** 顶栏右侧操作 HTML（如返回主菜单） */
  actionsHtml?: string;
  /** 顶栏内联状态（如归档中） */
  statusHtml?: string;
}

/** 顶栏单行横排：返回 / 标题 / 徽章 / 回合金币胜负 / 状态 / 操作 */
export function renderRunReviewHeaderHtml(opts: RunReviewHeaderOpts): string {
  const badge = opts.statusBadge === 'cleared'
    ? '<span class="fg-run-badge cleared">已通关</span>'
    : opts.statusBadge === 'in_progress'
      ? '<span class="fg-run-badge progress">进行中</span>'
      : '';
  const bits: string[] = [];
  if (opts.showGold) {
    bits.push(`<span class="fg-run-chip">完成 ${opts.maxRound ?? '-'} 回合</span>`);
    bits.push(`<span class="fg-run-chip">金币 ${opts.gold ?? '-'}</span>`);
  }
  bits.push(`<span class="fg-run-chip">胜 ${opts.wins}</span>`);
  bits.push(`<span class="fg-run-chip">负 ${opts.losses}</span>`);
  if (opts.showGold) {
    bits.push(`<span class="fg-run-chip">场次 ${opts.wins + opts.losses}</span>`);
  }
  return `<div class="fg-run-header fg-run-header-compact">
    ${opts.leadingHtml || ''}
    <h1 class="fg-run-title">${opts.title}</h1>
    ${badge}
    <div class="fg-run-chips">${bits.join('')}</div>
    ${opts.statusHtml || ''}
    ${opts.actionsHtml ? `<div class="fg-run-header-actions">${opts.actionsHtml}</div>` : ''}
  </div>`;
}

export interface RunReviewShellOpts extends RunReviewHeaderOpts {
  battles: BattleRecord[];
  /** 默认选中场次，默认 0 */
  selectedIdx?: number;
}

/** 三分区完整壳：上统计 + 左列表 + 竖分界 + 右详情 */
export function renderRunReviewShellHtml(opts: RunReviewShellOpts): string {
  const battles = opts.battles;
  const selectedIdx = battles.length
    ? Math.max(0, Math.min(opts.selectedIdx ?? 0, battles.length - 1))
    : -1;

  let listHtml = '';
  if (!battles.length) {
    listHtml = '<p class="fg-run-empty">暂无战斗记录</p>';
  } else {
    listHtml = '<div class="fg-run-list-inner" id="fg-run-battles">';
    battles.forEach((b, i) => {
      listHtml += battleListRow(b, i, i === selectedIdx);
    });
    listHtml += '</div>';
  }

  const detailHtml = selectedIdx >= 0
    ? renderBattleDetailHtml(battles[selectedIdx])
    : '<p class="fg-run-empty">选择左侧场次查看详情</p>';

  return `<div class="fg-run-layout" id="fg-run-layout">
    <div class="fg-run-top">${renderRunReviewHeaderHtml(opts)}</div>
    <div class="fg-run-body">
      <aside class="fg-run-list" aria-label="场次列表">${listHtml}</aside>
      <div id="fg-run-v-split" class="fg-split-v" title="拖动调整列表宽度"></div>
      <section class="fg-run-detail" id="fg-run-detail">${detailHtml}</section>
    </div>
  </div>`;
}

/** 回顾区内 BD 卡片折叠（只读，CSS 切换） */
function bindReviewCardCollapse(host: HTMLElement): void {
  const collapsedCards = new Set<string>();
  const collapsedAffixBlocks = new Set<string>();
  const collapsedChildBlocks = new Set<string>();

  host.querySelectorAll('.sb-card.sb-card-collapsed').forEach(el => {
    const id = (el.querySelector('[data-cardtoggle]') as HTMLElement | null)?.dataset.cardtoggle;
    if (id) collapsedCards.add(id);
  });

  host.querySelectorAll('[data-cardtoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.cardtoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = htmlEl.closest('.sb-card') as HTMLElement | null;
      if (!card) return;
      const collapsing = !collapsedCards.has(instanceId);
      if (collapsing) collapsedCards.add(instanceId);
      else collapsedCards.delete(instanceId);
      card.classList.toggle('sb-card-collapsed', collapsing);
      const btn = htmlEl.querySelector('.sb-card-collapse-btn');
      if (btn) btn.textContent = collapsing ? '展开' : '收起';
    });
  });

  host.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.affixblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !collapsedAffixBlocks.has(instanceId);
      if (collapsing) collapsedAffixBlocks.add(instanceId);
      else collapsedAffixBlocks.delete(instanceId);
      foldable.classList.toggle('sb-folded', collapsing);
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });

  host.querySelectorAll('[data-childblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.childblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      const preview = htmlEl.parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !collapsedChildBlocks.has(instanceId);
      if (collapsing) collapsedChildBlocks.add(instanceId);
      else collapsedChildBlocks.delete(instanceId);
      foldable.classList.toggle('sb-folded', collapsing);
      if (preview) preview.style.display = collapsing ? '' : 'none';
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });
}

function bindDetailPanel(detail: HTMLElement, battle: BattleRecord | null): void {
  bindSbTooltips(detail, battle ? instanceLookupForBattle(battle) : undefined);
  bindReviewCardCollapse(detail);
}

/** 绑定左列表选中 → 右详情刷新，并启用可拖分界线 */
export function bindRunReview(root: HTMLElement, battles: BattleRecord[]): void {
  const layout = (root.querySelector('#fg-run-layout') as HTMLElement | null) || root;
  bindRunReviewSplitters(layout);

  const list = root.querySelector('#fg-run-battles');
  const detail = root.querySelector('#fg-run-detail') as HTMLElement | null;
  if (!detail) return;

  if (battles.length) bindDetailPanel(detail, battles[0]);

  if (!list) return;
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-select-battle]') as HTMLElement | null;
    if (!btn || !list.contains(btn)) return;
    const idx = Number(btn.dataset.selectBattle);
    if (!Number.isFinite(idx) || idx < 0 || idx >= battles.length) return;

    list.querySelectorAll('.fg-run-list-item.is-selected').forEach(el => el.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    detail.innerHTML = renderBattleDetailHtml(battles[idx]);
    bindDetailPanel(detail, battles[idx]);
  });
}
