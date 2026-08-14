// ============================================================
// 通关结算 / 历史回顾 — 三分区：上统计 / 左场次列表 / 右详情
// BD 卡片与悬浮窗复用战斗壳 officialCombat 共用 API
// ============================================================

import { BattleRecord, CombatEvent, CombatUnitRuntime, GameEngine, estimateTotalGoldGainedFallback } from '../game/engine';
import { DeploySlot, ItemInstance } from '../game/data';
import { createCollapseState, collapseItemTree, CollapseState, CardSide } from './build/types';
import { bindRunReviewSplitters } from './splitters';
import { formatCombatEventLogHtml } from '../game/activeActionDisplay';
import {
  renderSlotsAsBattleCards,
  normalizeDeploySlotsInPlace,
  bindReadonlyBattleCardUi,
} from './officialCombat';

/** 预览用引擎（不污染当局存档；依赖全局已加载的 ENTITY/AFFIX 模板） */
let previewEngine: GameEngine | null = null;
function getPreviewEngine(): GameEngine {
  if (!previewEngine) previewEngine = new GameEngine();
  return previewEngine;
}

function cloneSlots(slots: DeploySlot[]): DeploySlot[] {
  return JSON.parse(JSON.stringify(slots)) as DeploySlot[];
}

/** 深拷贝 + normalize + 被动预览（与 BD/战斗构筑预览同源） */
function prepareSidePreview(slots: DeploySlot[] | null | undefined): {
  slots: DeploySlot[];
  units: CombatUnitRuntime[];
} {
  if (!slots || slots.length === 0) return { slots: [], units: [] };
  const cloned = cloneSlots(slots);
  normalizeDeploySlotsInPlace(cloned);
  const units = getPreviewEngine().previewBdRuntimes(cloned);
  return { slots: cloned, units };
}

function findInstanceInSlots(slots: DeploySlot[], instanceId: string): ItemInstance | null {
  for (const slot of slots) {
    if (slot.entity.instanceId === instanceId) return slot.entity;
    const walk = (n: ItemInstance): ItemInstance | null => {
      if (n.instanceId === instanceId) return n;
      for (const c of n.children || []) {
        const f = walk(c);
        if (f) return f;
      }
      return null;
    };
    const inEntity = walk(slot.entity);
    if (inEntity) return inEntity;
    for (const c of slot.children || []) {
      const f = walk(c);
      if (f) return f;
    }
  }
  return null;
}

function instanceLookupForSlots(
  playerSlots: DeploySlot[],
  enemySlots: DeploySlot[],
): (id: string, side?: CardSide) => ItemInstance | null {
  return (id, side) => {
    if (side === 'enemy') return findInstanceInSlots(enemySlots, id);
    if (side === 'player') return findInstanceInSlots(playerSlots, id);
    return findInstanceInSlots(playerSlots, id) || findInstanceInSlots(enemySlots, id);
  };
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

/** 本局各场战斗奖励金币合计（rewardGold 之和） */
export function sumBattleRewardGold(battles: BattleRecord[]): number {
  let total = 0;
  for (const b of battles) total += Number(b.rewardGold) || 0;
  return total;
}

/**
 * 结算展示用获取总金币：优先存档/当局累计（探险+事件+战斗）；
 * 旧历史无字段时回退战斗奖 + 可推断探险发放。
 */
export function resolveTotalGoldGained(opts: {
  totalGoldGained?: number;
  battles: BattleRecord[];
  maxRound?: number;
  currentRound?: number;
}): number {
  if (typeof opts.totalGoldGained === 'number') return opts.totalGoldGained;
  const maxR = opts.maxRound ?? 10;
  const round = opts.currentRound ?? maxR;
  return estimateTotalGoldGainedFallback(opts.battles, round, maxR);
}

function formatLogHtml(log: CombatEvent[]): string {
  if (!log?.length) return '<div class="sb-log-entry" style="color:var(--fg-text-muted);">无日志</div>';
  let h = '';
  for (let i = 0; i < log.length; i++) {
    h += formatCombatEventLogHtml(log[i]);
  }
  return h;
}

function defaultCollapseForSlots(slots: DeploySlot[], collapse: CollapseState, side: CardSide): void {
  for (const slot of slots) collapseItemTree(slot.entity, collapse, side);
}

function renderSideBd(
  slots: DeploySlot[],
  units: CombatUnitRuntime[],
  collapse: CollapseState,
  emptyHint: string,
  side: 'player' | 'enemy',
): string {
  const inner = slots.length === 0
    ? `<div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">${emptyHint}</div>`
    : renderSlotsAsBattleCards(slots, side, collapse, units);
  const sideId = side === 'player' ? 'fg-run-player-units' : 'fg-run-enemy-units';
  return `<div class="sb-battle-side" id="${sideId}">${inner}</div>`;
}

export interface BattleDetailRenderCtx {
  collapse: CollapseState;
  playerSlots: DeploySlot[];
  enemySlots: DeploySlot[];
  playerUnits: CombatUnitRuntime[];
  enemyUnits: CombatUnitRuntime[];
}

/** 准备一场战斗的预览 slots/units，并默认折叠卡片 */
export function prepareBattleDetailCtx(b: BattleRecord, collapse: CollapseState): BattleDetailRenderCtx {
  const player = prepareSidePreview(b.playerBd);
  const enemy = b.enemyBd == null
    ? { slots: [] as DeploySlot[], units: [] as CombatUnitRuntime[] }
    : prepareSidePreview(b.enemyBd);
  defaultCollapseForSlots(player.slots, collapse, 'player');
  defaultCollapseForSlots(enemy.slots, collapse, 'enemy');
  return {
    collapse,
    playerSlots: player.slots,
    enemySlots: enemy.slots,
    playerUnits: player.units,
    enemyUnits: enemy.units,
  };
}

/** 右侧：单场详情（双方 BD + 可拖横线 + 日志）；BD 区与战斗壳同款 sb-battle-side */
export function renderBattleDetailHtml(b: BattleRecord, detailCtx?: BattleDetailRenderCtx): string {
  const ctx = detailCtx ?? prepareBattleDetailCtx(b, createCollapseState());
  const opp = b.enemyBd == null ? '无对手' : (b.opponentName || '对手');
  const dur = b.durationMs != null ? ` · 时长 ${(b.durationMs / 1000).toFixed(1)}s` : '';
  let h = '<div class="fg-run-expand">';
  h += `<div class="fg-run-result-bar">结果：${resultLabel(b.result)} · 本场 +${b.rewardGold} 金 · ${opp}${dur}</div>`;
  h += '<div class="fg-run-detail-body">';
  h += '<div class="fg-run-bd-stack">';
  h += renderSideBd(ctx.playerSlots, ctx.playerUnits, ctx.collapse, '（空）', 'player');
  if (b.enemyBd == null) {
    h += `<div class="sb-battle-side" id="fg-run-enemy-units"><div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">对战池无对手 · 自动获胜</div></div>`;
  } else {
    h += renderSideBd(ctx.enemySlots, ctx.enemyUnits, ctx.collapse, '（空）', 'enemy');
  }
  h += '</div>';
  h += '<div id="fg-run-h-split" class="fg-split-h" title="拖动调整日志高度"></div>';
  h += '<div class="fg-run-log-stack">';
  h += `<div class="fg-run-log fg-battle-log">${formatLogHtml(b.log || [])}</div>`;
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
  /** 获取总金币（各场 rewardGold 合计）；通关结算/已通关历史展示 */
  totalRewardGold?: number;
  maxRound?: number;
  /** 为 true 时展示：完成回合 · 胜 · 负 · 获取总金币 */
  showSettlementStats?: boolean;
  /** 顶栏左侧 HTML（返回列表 / 返回主菜单等） */
  leadingHtml?: string;
  /** 顶栏右侧操作 HTML */
  actionsHtml?: string;
  /** 顶栏内联状态（如归档中） */
  statusHtml?: string;
}

/** 顶栏单行横排：返回 / 标题 / 徽章 / 完成回合胜负总金币 / 状态 / 操作 */
export function renderRunReviewHeaderHtml(opts: RunReviewHeaderOpts): string {
  const badge = opts.statusBadge === 'cleared'
    ? '<span class="fg-run-badge cleared">已通关</span>'
    : opts.statusBadge === 'in_progress'
      ? '<span class="fg-run-badge progress">进行中</span>'
      : '';
  const bits: string[] = [];
  if (opts.showSettlementStats) {
    bits.push(`<span class="fg-run-chip">完成 ${opts.maxRound ?? '-'} 回合</span>`);
  }
  bits.push(`<span class="fg-run-chip">胜 ${opts.wins}</span>`);
  bits.push(`<span class="fg-run-chip">负 ${opts.losses}</span>`);
  if (opts.showSettlementStats) {
    bits.push(`<span class="fg-run-chip">获取总金币 ${opts.totalRewardGold ?? 0}</span>`);
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

function bindDetailPanel(
  detail: HTMLElement,
  battle: BattleRecord,
  detailCtx: BattleDetailRenderCtx,
  onStructuralRebuild: () => void,
): void {
  const getInstance = instanceLookupForSlots(detailCtx.playerSlots, detailCtx.enemySlots);
  const findRoots = (id: string, side?: CardSide): ItemInstance[] | null => {
    const findSlot = (slots: DeploySlot[]) => slots.find(s => {
      const walk = (n: ItemInstance): boolean => {
        if (n.instanceId === id) return true;
        return (n.children || []).some(walk);
      };
      return walk(s.entity) || (s.children || []).some(walk);
    });
    let slot: DeploySlot | undefined;
    if (side === 'enemy') slot = findSlot(detailCtx.enemySlots);
    else if (side === 'player') slot = findSlot(detailCtx.playerSlots);
    else slot = findSlot(detailCtx.playerSlots) || findSlot(detailCtx.enemySlots);
    return slot ? [slot.entity, ...(slot.children || [])] : null;
  };

  bindReadonlyBattleCardUi(detail, {
    collapse: detailCtx.collapse,
    getInstance,
    getCombatUnit: (id, side) => {
      if (side === 'enemy') return detailCtx.enemyUnits.find(u => u.instanceId === id) || null;
      if (side === 'player') return detailCtx.playerUnits.find(u => u.instanceId === id) || null;
      return detailCtx.playerUnits.find(u => u.instanceId === id)
        || detailCtx.enemyUnits.find(u => u.instanceId === id)
        || null;
    },
    getConditionRoots: findRoots,
    onStructuralRebuild,
  });
}

/** 绑定左列表选中 → 右详情刷新，并启用可拖分界线 */
export function bindRunReview(root: HTMLElement, battles: BattleRecord[]): void {
  const layout = (root.querySelector('#fg-run-layout') as HTMLElement | null) || root;
  bindRunReviewSplitters(layout);

  const list = root.querySelector('#fg-run-battles');
  const detail = root.querySelector('#fg-run-detail') as HTMLElement | null;
  if (!detail) return;

  let selectedIdx = battles.length ? 0 : -1;
  let detailCtx: BattleDetailRenderCtx | null = null;

  const rebuild = () => {
    if (selectedIdx < 0 || !detailCtx) return;
    detail.innerHTML = renderBattleDetailHtml(battles[selectedIdx], detailCtx);
    bindDetailPanel(detail, battles[selectedIdx], detailCtx, rebuild);
  };

  const showBattle = (idx: number) => {
    if (idx < 0 || idx >= battles.length) return;
    selectedIdx = idx;
    const collapse = createCollapseState();
    detailCtx = prepareBattleDetailCtx(battles[idx], collapse);
    detail.innerHTML = renderBattleDetailHtml(battles[idx], detailCtx);
    bindDetailPanel(detail, battles[idx], detailCtx, rebuild);
  };

  if (battles.length) showBattle(0);

  if (!list) return;
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-select-battle]') as HTMLElement | null;
    if (!btn || !list.contains(btn)) return;
    const idx = Number(btn.dataset.selectBattle);
    if (!Number.isFinite(idx) || idx < 0 || idx >= battles.length) return;

    list.querySelectorAll('.fg-run-list-item.is-selected').forEach(el => el.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    showBattle(idx);
  });
}
