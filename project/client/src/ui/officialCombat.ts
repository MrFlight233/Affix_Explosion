// ============================================================
// 正式局战斗壳 — 对齐模拟战 sb 卡片树 / Solid 日志 / patchBattleValues
// ============================================================

import { GameEngine, CombatEvent, CombatUnitRuntime } from '../game/engine';
import {
  DeploySlot, ItemInstance,
  getEntityDef, findInTree,
} from '../game/data';
import { renderEntityCard } from './build/entityCard';
import { CollapseState, CardSide } from './build/types';
import { patchBattleValues } from './build/battlePatch';
import { bindSbTooltips, type SbInstanceLookup, type SbCombatUnitLookup, type SbConditionRootsLookup } from './build/simTooltip';
import { mountBattleLog, type BattleLogBridge } from './sim/mountBattleLog';
import { consumeSuppressNextClick, isPointerDragging } from './pointerDrag';

export interface OfficialCombatResultSummary {
  win: boolean;
  gold: number;
  autoWin: boolean;
}

export interface OfficialCombatCtx {
  engine: GameEngine;
  collapse: CollapseState;
  combatLog: CombatEvent[];
  combatFinished: boolean;
  combatResultSummary: OfficialCombatResultSummary | null;
  /** 开战时缓存的敌方 BD（结束态仍用于卡片树） */
  combatEnemySlots: DeploySlot[] | null;
  finalPlayerUnits: CombatUnitRuntime[] | null;
  finalEnemyUnits: CombatUnitRuntime[] | null;
  pendingAutoWin: boolean;
  weaponPrevRemaining: Map<string, number>;
  lastTickWallTime: number;
  lastLogCount: number;
  battleLogBridge: BattleLogBridge | null;
  onContinue: () => void;
  /** 需重建卡片树时（固定/动态词条折叠） */
  onRebuildSides: () => void;
}

function normalizeSlots(slots: DeploySlot[]): void {
  normalizeDeploySlotsInPlace(slots);
}

export function getOfficialCombatUnits(
  ctx: OfficialCombatCtx,
  side: 'player' | 'enemy',
): CombatUnitRuntime[] | null {
  if (ctx.combatFinished) {
    return side === 'player' ? ctx.finalPlayerUnits : ctx.finalEnemyUnits;
  }
  return side === 'player'
    ? ctx.engine.combatPlayerUnits
    : ctx.engine.combatEnemyUnits;
}

function getSideSlots(ctx: OfficialCombatCtx, side: 'player' | 'enemy'): DeploySlot[] {
  if (side === 'player') {
    normalizeSlots(ctx.engine.state.deploySlots);
    return ctx.engine.state.deploySlots;
  }
  const slots = ctx.combatEnemySlots;
  if (slots) normalizeSlots(slots);
  return slots || [];
}

function stubItemFromUnit(u: CombatUnitRuntime): ItemInstance {
  return { instanceId: u.instanceId, defId: u.entityId, type: 'entity', children: [] };
}

/** 将 slot.children 并入 entity.children（就地）；回顾渲染请先深拷贝再调用 */
export function normalizeDeploySlotsInPlace(slots: DeploySlot[]): void {
  for (const slot of slots) {
    if (!slot.children || slot.children.length === 0) continue;
    if (!slot.entity.children) slot.entity.children = [];
    for (const c of slot.children) {
      if (!slot.entity.children.some(x => x.instanceId === c.instanceId)) {
        slot.entity.children.push(c);
      }
    }
    slot.children = [];
  }
}

/**
 * 战斗态卡片树（与开战侧栏同款）：有 slot 用树 + unit；无 slot 则按 runtime 兜底。
 * 结算/历史回顾与正式战斗共用。
 */
export function renderSlotsAsBattleCards(
  slots: DeploySlot[],
  side: 'player' | 'enemy',
  collapse: CollapseState,
  units: CombatUnitRuntime[] | null | undefined,
): string {
  if (slots.length > 0) {
    let h = '';
    for (const slot of slots) {
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;
      const unit = units?.find(u => u.instanceId === slot.entity.instanceId);
      h += renderEntityCard(slot.entity, 0, side, 'battle', collapse, unit, [slot.entity, ...slot.children]);
    }
    return h || '<div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">无单位</div>';
  }

  if (!units || units.length === 0) {
    return '<div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">无单位</div>';
  }
  let h = '';
  for (const u of units) {
    h += renderEntityCard(stubItemFromUnit(u), 0, side, 'battle', collapse, u);
  }
  return h;
}

/** 渲染一侧战斗卡片树（有 slot 用树；否则按 runtime 列表兜底） */
export function renderBattleSideCards(
  ctx: OfficialCombatCtx,
  side: 'player' | 'enemy',
  units: CombatUnitRuntime[] | null,
): string {
  return renderSlotsAsBattleCards(getSideSlots(ctx, side), side, ctx.collapse, units);
}

export function renderOfficialPlayerCombatHtml(ctx: OfficialCombatCtx): string {
  const units = getOfficialCombatUnits(ctx, 'player');
  if (!ctx.combatFinished && (!units || units.length === 0)) {
    return '<div class="sb-battle-side" id="sb-player-units"><div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">准备中...</div></div>';
  }
  return `<div class="sb-battle-side" id="sb-player-units">${renderBattleSideCards(ctx, 'player', units)}</div>`;
}

export function renderOfficialEnemyCombatHtml(ctx: OfficialCombatCtx): string {
  if (ctx.combatFinished && ctx.combatResultSummary?.autoWin) {
    return '<div class="sb-battle-side" id="sb-enemy-units"><div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">对战池无对手 · 自动获胜</div></div>';
  }
  if (ctx.pendingAutoWin && !ctx.combatFinished) {
    return '<div class="sb-battle-side" id="sb-enemy-units"><div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">对战池无对手 · 自动获胜</div></div>';
  }
  const units = getOfficialCombatUnits(ctx, 'enemy');
  if (!ctx.combatFinished && (!units || units.length === 0) && !ctx.combatEnemySlots?.length) {
    return '<div class="sb-battle-side" id="sb-enemy-units"><div style="color:var(--sb-text-muted,#999);font-size:12px;padding:8px;">准备战斗...</div></div>';
  }
  return `<div class="sb-battle-side" id="sb-enemy-units">${renderBattleSideCards(ctx, 'enemy', units)}</div>`;
}

export function renderOfficialCombatCenterHtml(ctx: OfficialCombatCtx): string {
  let h = '<div class="fg-combat-center">';

  if (ctx.combatFinished && ctx.combatResultSummary) {
    const s = ctx.combatResultSummary;
    const title = s.autoWin ? '对战池无对手 · 自动获胜' : (s.win ? '战斗胜利' : '战斗失败');
    h += `<div class="fg-battle-result">
      <div class="fg-summary-title">${title}</div>
      <div class="fg-summary-gold">本场待结算 ${s.gold >= 0 ? '+' : ''}${s.gold}</div>
      <button id="btn-continue-combat-center" class="fg-btn-primary">继续</button>
    </div>`;
  }

  h += '<div id="fg-battle-log" class="fg-battle-log"></div>';
  h += '</div>';
  return h;
}

export function disposeOfficialBattleLog(ctx: OfficialCombatCtx): void {
  ctx.battleLogBridge?.dispose();
  ctx.battleLogBridge = null;
}

/** 挂载 Solid 日志；若已挂在同一 host 则只同步事件 */
export function ensureOfficialBattleLog(ctx: OfficialCombatCtx): void {
  const host = document.getElementById('fg-battle-log');
  if (!host) return;
  if (!ctx.battleLogBridge) {
    ctx.battleLogBridge = mountBattleLog(host);
  }
  ctx.battleLogBridge.setEvents(ctx.combatLog);
  host.scrollTop = host.scrollHeight;
}

export function pushOfficialBattleLogEvent(ctx: OfficialCombatCtx, evt: CombatEvent): void {
  ctx.battleLogBridge?.pushEvent(evt);
  const host = document.getElementById('fg-battle-log');
  if (host) host.scrollTop = host.scrollHeight;
}

function findInstanceInSlots(slots: DeploySlot[], instanceId: string): ItemInstance | null {
  for (const slot of slots) {
    if (slot.entity.instanceId === instanceId) return slot.entity;
    const found = findInTree(slot.entity, instanceId);
    if (found) return found;
    for (const c of slot.children || []) {
      if (c.instanceId === instanceId) return c;
      const f = findInTree(c, instanceId);
      if (f) return f;
    }
  }
  return null;
}

export function getOfficialCombatInstance(
  ctx: OfficialCombatCtx,
  instanceId: string,
  side?: CardSide,
): ItemInstance | null {
  if (side === 'enemy') {
    return findInstanceInSlots(ctx.combatEnemySlots || [], instanceId);
  }
  if (side === 'player' || side === 'warehouse') {
    return findInstanceInSlots(ctx.engine.state.deploySlots, instanceId);
  }
  return findInstanceInSlots(ctx.engine.state.deploySlots, instanceId)
    || findInstanceInSlots(ctx.combatEnemySlots || [], instanceId);
}

export interface ReadonlyBattleCardBindOpts {
  collapse: CollapseState;
  getInstance: SbInstanceLookup;
  getCombatUnit: SbCombatUnitLookup;
  getConditionRoots: SbConditionRootsLookup;
  /** 固定词条/战斗修饰/动态行等结构折叠时重建 DOM */
  onStructuralRebuild?: () => void;
}

/**
 * 战斗卡折叠 + sb 悬浮窗（只读场景与战斗壳共用）。
 * 不含「继续」等战斗壳专属按钮。
 * dataset 折叠键已为 side:instanceId，直接用于 Collapse Set。
 */
export function bindReadonlyBattleCardUi(root: HTMLElement, opts: ReadonlyBattleCardBindOpts): void {
  root.querySelectorAll('[data-cardtoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const key = htmlEl.dataset.cardtoggle!;
    htmlEl.addEventListener('click', (e) => {
      if (consumeSuppressNextClick() || isPointerDragging()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      const card = htmlEl.closest('.sb-card') as HTMLElement | null;
      if (!card) return;
      const collapsing = !opts.collapse.collapsedCards.has(key);
      if (collapsing) opts.collapse.collapsedCards.add(key);
      else opts.collapse.collapsedCards.delete(key);
      card.classList.toggle('sb-card-collapsed', collapsing);
      const btn = htmlEl.querySelector('.sb-card-collapse-btn');
      if (btn) btn.textContent = collapsing ? '展开' : '收起';
    });
  });

  root.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const key = htmlEl.dataset.affixblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !opts.collapse.collapsedAffixBlocks.has(key);
      if (collapsing) opts.collapse.collapsedAffixBlocks.add(key);
      else opts.collapse.collapsedAffixBlocks.delete(key);
      foldable.classList.toggle('sb-folded', collapsing);
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });

  root.querySelectorAll('[data-childblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const key = htmlEl.dataset.childblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      const preview = htmlEl.parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !opts.collapse.collapsedChildBlocks.has(key);
      if (collapsing) opts.collapse.collapsedChildBlocks.add(key);
      else opts.collapse.collapsedChildBlocks.delete(key);
      foldable.classList.toggle('sb-folded', collapsing);
      if (preview) preview.style.display = collapsing ? '' : 'none';
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });

  const rebuild = opts.onStructuralRebuild;
  if (rebuild) {
    root.querySelectorAll('[data-fixtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const key = htmlEl.dataset.fixtoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opts.collapse.expandedFixedAffixRows.has(key)) {
          opts.collapse.expandedFixedAffixRows.delete(key);
        } else {
          opts.collapse.expandedFixedAffixRows.add(key);
        }
        rebuild();
      });
    });

    root.querySelectorAll('[data-combatmodtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const key = htmlEl.dataset.combatmodtoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opts.collapse.expandedCombatModBlocks.has(key)) {
          opts.collapse.expandedCombatModBlocks.delete(key);
        } else {
          opts.collapse.expandedCombatModBlocks.add(key);
        }
        rebuild();
      });
    });

    root.querySelectorAll('[data-dyntoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const key = htmlEl.dataset.dyntoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opts.collapse.collapsedDynAffixRows.has(key)) {
          opts.collapse.collapsedDynAffixRows.delete(key);
        } else {
          opts.collapse.collapsedDynAffixRows.add(key);
        }
        rebuild();
      });
    });
  }

  bindSbTooltips(root, opts.getInstance, opts.getCombatUnit, opts.getConditionRoots);
}

/** 折叠 + tooltip；简单折叠只切 CSS，结构折叠触发 onRebuildSides */
export function bindOfficialCombatInteractions(root: HTMLElement, ctx: OfficialCombatCtx): void {
  const lookupCu: SbCombatUnitLookup = (id, side) => {
    if (side === 'enemy') {
      return getOfficialCombatUnits(ctx, 'enemy')?.find(u => u.instanceId === id) || null;
    }
    if (side === 'player') {
      return getOfficialCombatUnits(ctx, 'player')?.find(u => u.instanceId === id) || null;
    }
    const pu = getOfficialCombatUnits(ctx, 'player');
    const eu = getOfficialCombatUnits(ctx, 'enemy');
    return pu?.find(u => u.instanceId === id) || eu?.find(u => u.instanceId === id) || null;
  };
  const lookupRoots: SbConditionRootsLookup = (id, side) => {
    const findSlot = (slots: DeploySlot[]) => slots.find(s => {
      const walk = (n: ItemInstance): boolean => {
        if (n.instanceId === id) return true;
        return (n.children || []).some(walk);
      };
      return walk(s.entity) || s.children.some(walk);
    });
    let slot: DeploySlot | undefined;
    if (side === 'enemy') slot = findSlot(getSideSlots(ctx, 'enemy'));
    else if (side === 'player') slot = findSlot(getSideSlots(ctx, 'player'));
    else slot = findSlot(getSideSlots(ctx, 'player')) || findSlot(getSideSlots(ctx, 'enemy'));
    return slot ? [slot.entity, ...slot.children] : null;
  };

  bindReadonlyBattleCardUi(root, {
    collapse: ctx.collapse,
    getInstance: (id, side) => getOfficialCombatInstance(ctx, id, side),
    getCombatUnit: lookupCu,
    getConditionRoots: lookupRoots,
    onStructuralRebuild: () => ctx.onRebuildSides(),
  });

  const btn = document.getElementById('btn-continue-combat-center');
  if (btn) {
    btn.onclick = () => ctx.onContinue();
  }
}

export function patchOfficialBattleValues(ctx: OfficialCombatCtx): void {
  const timeRef = {
    get current() { return ctx.lastTickWallTime; },
    set current(v: number) { ctx.lastTickWallTime = v; },
  };
  const logRef = {
    get current() { return ctx.lastLogCount; },
    set current(v: number) { ctx.lastLogCount = v; },
  };
  patchBattleValues(
    ctx.engine,
    ctx.weaponPrevRemaining,
    timeRef,
    () => ctx.engine.combatSpeed,
    { p: 'p', e: 'e' },
    {
      battleLogLength: ctx.combatLog.length,
      battleFinished: ctx.combatFinished,
      playerUnits: getOfficialCombatUnits(ctx, 'player'),
      enemyUnits: getOfficialCombatUnits(ctx, 'enemy'),
      bodySelector: '#main-layout',
      headerSelector: '#fg-battle-header',
      lastLogCountRef: logRef,
    },
  );
}
