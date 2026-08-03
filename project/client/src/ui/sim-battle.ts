// ============================================================
// 模拟对战 — 管理员专用的 BD 测试与战斗模拟工具
// ============================================================

import { GameEngine, CombatEvent, CombatUnitRuntime, PlaybackSpeed } from '../game/engine';
import {
  EntityDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, isStarter,
  getEffectiveEntitySlots, countUsedSlots, countUsedAffixSlots,
  canMountAffix, canRemoveAffix, getFirstLayerSlots,
} from '../game/data';
import {
  beginPointerDrag, consumeSuppressNextClick, isPointerDragging,
  PointerDragSession, PointerDragHit,
} from './pointerDrag';
import { data as dataApi } from '../api/client';
import { mountBattleLog, type BattleLogBridge } from './sim/mountBattleLog';
import { renderPlaybackControlsHtml } from './playbackControls';
import type { CollapseState } from './build/types';
import { renderEntityCard } from './build/entityCard';
import { formatCombatEventLogHtml } from '../game/activeActionDisplay';
import { showAppToast } from './toast';
import {
  renderPoolFiltersHtml, renderPoolItemListHtml, bindPoolFilterEvents,
  type PoolFilterState,
} from './build/poolList';
import {
  showSimTooltip, hideSimTooltip, disposeSimTooltip,
  bindSbTooltips, bindTooltipOnRoot,
} from './build/simTooltip';
import { patchBattleValues } from './build/battlePatch';

// ============================================================
// 状态类型
// ============================================================

/** 仅战斗回合：与正式局对战池 round 一致；槽位 = floor((round+1)/2) */
const COMBAT_ROUNDS = [2, 4, 6, 8, 10];

interface SimBattleState {
  round: number;
  playerSlots: DeploySlot[];
  enemySlots: DeploySlot[];
  poolCollapsed: boolean;
  poolSearch: string;
  entityCatFilter: string;
  affixCatFilter: string;
  collapsedPoolSections: Set<string>;  // "section:entity" | "section:affix" | "cat:武器" | ...
  collapsedCards: Set<string>;
  collapsedAffixBlocks: Set<string>;
  collapsedChildBlocks: Set<string>;
  collapsedFixedAffixRows: Set<string>;
  collapsedDynAffixRows: Set<string>;
  inBattle: boolean;
  battleFinished: boolean;
  battlePaused: boolean;
  combatSpeed: PlaybackSpeed;
  playerWin: boolean | null;
  battleLog: CombatEvent[];
  battleUpdateTimer: number | null;
  finalPlayerUnits: CombatUnitRuntime[] | null;
  finalEnemyUnits: CombatUnitRuntime[] | null;
  lastTickWallTime: number;
  lastLogCount: number;
  toast: string | null;
}

// ============================================================
// 主入口
// ============================================================

export async function showSimBattle(onBack: () => void): Promise<void> {
  const app = document.getElementById('app')!;
  const engine = new GameEngine();

  const state: SimBattleState = {
    round: 2,
    playerSlots: [],
    enemySlots: [],
    poolCollapsed: false,
    poolSearch: '',
    entityCatFilter: 'all',
    affixCatFilter: 'all',
    collapsedPoolSections: new Set(),
    collapsedCards: new Set(),
    collapsedAffixBlocks: new Set(),
    collapsedChildBlocks: new Set(),
    collapsedFixedAffixRows: new Set(),
    collapsedDynAffixRows: new Set(),
    inBattle: false,
    battleFinished: false,
    battlePaused: false,
    combatSpeed: 1,
    playerWin: null,
    battleLog: [],
    battleUpdateTimer: null,
    finalPlayerUnits: null,
    finalEnemyUnits: null,
    lastTickWallTime: 0,
    lastLogCount: 0,
    toast: null,
  };

  /** 记录每个 cu-cd span 上一次引擎 tick 后的 remainingTime，用于平滑插值 */
  const weaponPrevRemaining = new Map<string, number>();
  /** BD 面板 pointer 委托是否已绑定 */
  let stablePointerBound = false;
  let battleLogBridge: BattleLogBridge | null = null;
  let cancelled = false;

  function getCollapse(): CollapseState {
    return {
      collapsedCards: state.collapsedCards,
      collapsedAffixBlocks: state.collapsedAffixBlocks,
      collapsedChildBlocks: state.collapsedChildBlocks,
      collapsedFixedAffixRows: state.collapsedFixedAffixRows,
      collapsedDynAffixRows: state.collapsedDynAffixRows,
    };
  }

  function getPoolFilterState(): PoolFilterState {
    return state;
  }

  function getInstance(instanceId: string): ItemInstance | null {
    return findItemInSlots(state.playerSlots, instanceId) || findItemInSlots(state.enemySlots, instanceId);
  }

  function refreshDeployUI(changedSides: Array<'player' | 'enemy'>, alsoPool = false) {
    if (!buildSkeletonReady) {
      renderZones();
      return;
    }
    for (const side of changedSides) {
      const id = side === 'player' ? 'sb-player-bd' : 'sb-enemy-bd';
      updateZone(id, renderDeployArea(side));
    }
    if (alsoPool) {
      updateZone('sb-pool', renderPoolContent());
      bindPoolEvents();
    }
    bindPointerDragEvents();
    bindTooltipEvents();
    bindCardCollapseEvents();
  }

  // ============================================================
  // Zone 渲染系统 — 骨架常驻 + 分区更新
  // ============================================================

  let buildSkeletonReady = false;
  let battleSkeletonReady = false;

  function updateZone(id: string, html: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const st = el.scrollTop;
    el.innerHTML = html;
    requestAnimationFrame(() => { el.scrollTop = st; });
  }

  function createBuildSkeleton() {
    stablePointerBound = false;
    const poolBtn = state.poolCollapsed ? '▶' : '◀';
    app.innerHTML = `
      <div id="sb-page">
        <div id="sb-header"></div>
        <div id="sb-main" style="position:relative;display:flex;flex:1;overflow:hidden;">
          <div id="sb-pool" class="${state.poolCollapsed ? 'collapsed' : ''}" style="position:relative;"></div>
          <button id="sb-pool-toggle" style="position:absolute;left:${state.poolCollapsed ? '0' : '280px'};top:50%;transform:translateY(-50%);z-index:10;">${poolBtn}</button>
          <div id="sb-player-bd"></div>
          <div id="sb-enemy-bd"></div>
        </div>
        <div id="sb-toast"></div>
      </div>
    `;
    // 一次性绑定骨架级事件
    bindSkeletonEvents();
    buildSkeletonReady = true;
    battleSkeletonReady = false;
  }

  function createBattleSkeleton() {
    app.innerHTML = `
      <div id="sb-battle-view">
        <div id="sb-battle-header"></div>
        <div id="sb-battle-body"></div>
        <div id="sb-battle-log"></div>
        <div id="sb-battle-result"></div>
        <div id="sb-toast"></div>
      </div>
    `;
    bindBattleSkeletonEvents();
    battleSkeletonReady = true;
    buildSkeletonReady = false;
  }

  function bindSkeletonEvents() {
    // 返回按钮委托
    document.getElementById('sb-header')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('#sb-btn-back');
      if (btn) {
        hideSimTooltip();
        if (state.battleUpdateTimer) { cancelAnimationFrame(state.battleUpdateTimer); state.battleUpdateTimer = null; }
        disposeSimTooltip();
        onBack();
      }
    });
    // 回合选择委托
    document.getElementById('sb-header')!.addEventListener('change', (e) => {
      const sel = (e.target as HTMLElement).closest('#sb-round');
      if (sel) {
        state.round = parseInt((sel as HTMLSelectElement).value);
        renderZones();
      }
    });
    // 开始战斗委托
    document.getElementById('sb-header')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('#sb-btn-start');
      if (btn) startSimBattle();
    });
    // 从对战池抽取 BD 按钮委托
    document.getElementById('sb-main')!.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('.sb-draw-pool-btn');
      if (!btn) return;
      const side = (btn as HTMLElement).dataset.side as 'player' | 'enemy';
      btn.textContent = '抽取中...';
      (btn as HTMLButtonElement).disabled = true;
      const bd = await drawFromPool(state.round);
      (btn as HTMLButtonElement).disabled = false;
      if (bd) {
        ingestSlotsForSim(bd);
        if (side === 'player') state.playerSlots = bd;
        else state.enemySlots = bd;
        // 所有可折叠卡片默认折叠
        collapseAllCards(bd);
        renderZones();
        showToast(`已从对战池抽取 ${side === 'player' ? '玩家' : '对手'} BD`);
      } else {
        btn.textContent = '从对战池抽取';
        showToast('对战池中暂无该回合的 BD');
      }
    });
    // Pool 折叠按钮
    document.getElementById('sb-pool-toggle')!.addEventListener('click', () => {
      state.poolCollapsed = !state.poolCollapsed;
      const poolEl = document.getElementById('sb-pool')!;
      const toggleEl = document.getElementById('sb-pool-toggle')!;
      if (state.poolCollapsed) {
        poolEl.classList.add('collapsed');
        toggleEl.style.left = '0';
        toggleEl.textContent = '▶';
      } else {
        poolEl.classList.remove('collapsed');
        toggleEl.style.left = '280px';
        toggleEl.textContent = '◀';
      }
    });
  }

  function bindBattleSkeletonEvents() {
    document.getElementById('sb-battle-header')!.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const backBtn = target.closest('#sb-btn-edit-back');
      const pauseBtn = target.closest('#sb-btn-pause');
      const speedBtn = target.closest('[data-speed]') as HTMLElement | null;
      if (backBtn) {
        hideSimTooltip();
        cancelled = true;
        if (state.battleUpdateTimer !== null) { cancelAnimationFrame(state.battleUpdateTimer); state.battleUpdateTimer = null; }
        disposeSimTooltip();
        state.inBattle = false; state.battleFinished = false; state.battlePaused = false;
        state.battleLog = [];
        renderZones();
      }
      if (pauseBtn) {
        state.battlePaused = !state.battlePaused;
        if (!state.battlePaused) state.lastTickWallTime = Date.now(); // 恢复时重置插值时钟
        updateZone('sb-battle-header', renderBattleHeader());
      }
      if (speedBtn?.dataset.speed) {
        const raw = speedBtn.dataset.speed;
        const spd: PlaybackSpeed = raw === 'max' ? 'max' : (Number(raw) as 1 | 2 | 4);
        state.combatSpeed = spd;
        engine.combatSpeed = spd;
        updateZone('sb-battle-header', renderBattleHeader());
      }
    });
  }

  // ============================================================
  // 槽位校验
  // ============================================================

  function canPlaceInSlot(
    slots: DeploySlot[], round: number,
    targetSlotIdx: number | undefined,
    parentInstanceId: string | null | undefined,
    childDef: EntityDef,
  ): string | null {
    // starter 不能放入子槽位
    if (parentInstanceId != null && isStarter(childDef)) return '启动端实体不能放入其他实体的槽位';

    if (parentInstanceId == null) {
      // 第一层：与正式局相同，上限 = floor((round+1)/2)
      const maxSlots = getFirstLayerSlots(round);
      let usedSlots = 0;
      for (const s of slots) {
        const d = getEntityDef(s.entity.defId);
        if (d) usedSlots += d.slotCost;
      }
      if (usedSlots + childDef.slotCost > maxSlots) {
        return `第一层槽位不足(剩${maxSlots - usedSlots},需${childDef.slotCost})`;
      }
      return null;
    }

    // 嵌套
    const parent = findItemInSlots(slots, parentInstanceId);
    if (!parent) return '父实体不存在';
    const parentDef = getEntityDef(parent.defId);
    if (!parentDef) return '未知父实体类型';

    if (isStarter(childDef)) return '启动端实体不能放入其他实体的槽位';

    const effectiveSlots = getEffectiveEntitySlots(parentDef);
    const used = countUsedSlots(parent);
    if (childDef.slotCost > effectiveSlots - used) {
      return `子实体槽位不足(剩${effectiveSlots - used},需${childDef.slotCost})`;
    }
    return null;
  }

  function findItemInSlots(slots: DeploySlot[], instanceId: string | null): ItemInstance | null {
    if (!instanceId) return null;
    for (const s of slots) {
      if (s.entity.instanceId === instanceId) return s.entity;
      const found = findInTree(s.entity, instanceId);
      if (found) return found;
      for (const c of s.children) {
        if (c.instanceId === instanceId) return c;
        const f2 = findInTree(c, instanceId);
        if (f2) return f2;
      }
    }
    return null;
  }

  function findInTree(root: ItemInstance, id: string): ItemInstance | null {
    if (root.instanceId === id) return root;
    if (root.children) {
      for (const c of root.children) {
        const f = findInTree(c, id);
        if (f) return f;
      }
    }
    return null;
  }

  /** 递归收集 DeploySlot 树中所有实体的 instanceId */
  function collectEntityIds(slots: DeploySlot[]): string[] {
    const ids: string[] = [];
    const walk = (item: ItemInstance) => {
      if (item.type === 'entity') ids.push(item.instanceId);
      for (const c of (item.children || [])) walk(c);
    };
    for (const s of slots) {
      walk(s.entity);
      for (const c of s.children) walk(c);
    }
    return ids;
  }

  /** 将 BD 所有可折叠卡片设为折叠状态 */
  function collapseAllCards(slots: DeploySlot[]) {
    for (const id of collectEntityIds(slots)) {
      state.collapsedCards.add(id);
    }
  }

  function removeFromSlots(slots: DeploySlot[], instanceId: string): boolean {
    // 检查顶层
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].entity.instanceId === instanceId) {
        slots.splice(i, 1);
        return true;
      }
    }
    // 递归搜索 entity 树；成功后仍清 slot.children，避免浅拷贝残留
    for (const s of slots) {
      if (removeFromTree(s.entity, instanceId)) {
        pruneFromSlotChildren(s, instanceId);
        return true;
      }
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === instanceId) {
          s.children.splice(i, 1);
          return true;
        }
        if (removeFromTree(s.children[i], instanceId)) {
          pruneFromSlotChildren(s, instanceId);
          return true;
        }
      }
    }
    return false;
  }

  /** 从 slot.children（含子树）按 instanceId 清除，防止与 entity.children 双份残留 */
  function pruneFromSlotChildren(slot: DeploySlot, instanceId: string): void {
    for (let i = slot.children.length - 1; i >= 0; i--) {
      if (slot.children[i].instanceId === instanceId) {
        slot.children.splice(i, 1);
        continue;
      }
      removeFromTree(slot.children[i], instanceId);
    }
  }

  /**
   * 模拟对战约定：子项只挂 entity.children。
   * 抽池等主游戏风格 BD：把 slot.children 并入 entity 后清空。
   */
  function ingestSlotsForSim(slots: DeploySlot[]): void {
    for (const slot of slots) {
      if (!slot.children) slot.children = [];
      if (slot.children.length === 0) continue;
      if (!slot.entity.children) slot.entity.children = [];
      for (const c of slot.children) {
        if (!findInTree(slot.entity, c.instanceId)) {
          slot.entity.children.push(c);
        }
      }
      slot.children = [];
    }
  }

  /** 开战前：清空 slot.children，避免历史浅拷贝幽灵子实体被引擎再次合并 */
  function sanitizeSimSlotsBeforeCombat(slots: DeploySlot[]): void {
    for (const slot of slots) {
      slot.children = [];
    }
  }

  function removeFromTree(root: ItemInstance, id: string): boolean {
    if (!root.children) return false;
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i].instanceId === id) {
        root.children.splice(i, 1);
        return true;
      }
      if (removeFromTree(root.children[i], id)) return true;
    }
    return false;
  }

  function getSlots(side: 'player' | 'enemy'): DeploySlot[] {
    return side === 'player' ? state.playerSlots : state.enemySlots;
  }

  // ============================================================
  // Toast
  // ============================================================

  function showToast(msg: string) {
    state.toast = msg;
    showAppToast(msg, { host: 'sb-toast' });
  }

  // ============================================================
  // 渲染入口 — zone 系统
  // ============================================================

  function renderZones() {
    if (state.inBattle) {
      if (!battleSkeletonReady) createBattleSkeleton();
      updateZone('sb-battle-header', renderBattleHeader());
      const pu = getCombatUnits('player');
      const eu = getCombatUnits('enemy');
      document.getElementById('sb-battle-body')!.innerHTML =
        `<div class="sb-battle-side" id="sb-player-units">${renderBattleSideCards('player', pu)}</div>` +
        `<div class="sb-battle-side" id="sb-enemy-units">${renderBattleSideCards('enemy', eu)}</div>`;
      const logHost = document.getElementById('sb-battle-log')!;
      battleLogBridge?.dispose();
      battleLogBridge = mountBattleLog(logHost);
      battleLogBridge.setEvents(state.battleLog);
      const resultEl = document.getElementById('sb-battle-result')!;
      if (state.battleFinished) {
        const durationSec = (engine.combatTime / 1000).toFixed(1);
        resultEl.innerHTML = `${state.playerWin ? '玩家胜利' : '玩家失败'} · 用时 ${durationSec}s`;
        resultEl.style.display = '';
      } else {
        resultEl.style.display = 'none';
      }
      bindCardCollapseEvents();
      bindBattleTooltips();
    } else {
      if (!buildSkeletonReady) createBuildSkeleton();
      updateZone('sb-header', renderHeaderContent());
      updateZone('sb-pool', renderPoolContent());
      bindPoolEvents();
      // 更新两个 BD zone（仅内容，不绑事件）
      updateZone('sb-player-bd', renderDeployArea('player'));
      updateZone('sb-enemy-bd', renderDeployArea('enemy'));
      // 一次性绑所有 BD 事件（避免双绑）
      bindPointerDragEvents();
      bindTooltipEvents();
      bindCardCollapseEvents();
    }
  }

  function renderHeaderContent(): string {
    return `
      <button class="btn" id="sb-btn-back">← 返回</button>
      <strong>模拟对战</strong>
      <span>回合:</span>
      <select id="sb-round" style="padding:2px 4px;font-size:13px;">
        ${COMBAT_ROUNDS.map(r => {
          const slots = getFirstLayerSlots(r);
          return `<option value="${r}"${state.round === r ? ' selected' : ''}>回合${r} (战斗, 槽位${slots})</option>`;
        }).join('')}
      </select>
      <button class="btn" id="sb-btn-start" style="font-weight:bold;">开始模拟战斗</button>
    `;
  }

  function renderBattleHeader(): string {
    return `
      <button class="btn" id="sb-btn-edit-back">← 返回编辑</button>
      <strong>模拟对战 · 回合${state.round}</strong>
      ${state.battleFinished ? `<span>战斗结束 · 用时 ${(engine.combatTime / 1000).toFixed(1)}s</span>` : `<span>模拟时间: ${(engine.combatTime / 1000).toFixed(1)}s</span>`}
      <span style="flex:1;"></span>
      ${renderPlaybackControlsHtml({ speed: state.combatSpeed, paused: state.battlePaused }, 'sb-btn-pause')}
    `;
  }

  function renderPoolContent(): string {
    return renderPoolFiltersHtml(getPoolFilterState()) + renderPoolItemListHtml(getPoolFilterState());
  }

  function renderDeployArea(side: 'player' | 'enemy'): string {
    const slots = getSlots(side);
    const label = side === 'player' ? '玩家' : '敌人';
    let usedSlots = 0;
    for (const s of slots) {
      const d = getEntityDef(s.entity.defId);
      if (d) usedSlots += d.slotCost;
    }

    let h = `<div class="sb-deploy-area" data-sort-list="top" data-accept="entity" data-side="${side}">`;
    const maxSlots = getFirstLayerSlots(state.round);
    h += `<div class="sb-slot-header">${label} BD &nbsp; 第一层 ${usedSlots} / ${maxSlots} 槽位`;
    h += ` <button class="btn sb-draw-pool-btn" data-side="${side}" style="font-size:11px;padding:2px 8px;margin-left:8px;">从对战池抽取</button>`;
    h += `</div>`;
    if (slots.length === 0) {
      h += '<div style="color:#999;font-size:12px;padding:8px;">拖入实体到第一层</div>';
    }

    // 渲染每个 slot 的第一层实体卡片（starter 和木桩都渲染）及其子实体
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;
      h += renderEntityCard(slot.entity, 0, side, 'build', getCollapse());
    }

    h += '</div>';
    return h;
  }

  // ---- 战斗视图 ----

  function getCombatUnits(side: 'player' | 'enemy'): CombatUnitRuntime[] | null {
    if (state.battleFinished) return side === 'player' ? state.finalPlayerUnits : state.finalEnemyUnits;
    return side === 'player' ? engine.combatPlayerUnits : engine.combatEnemyUnits;
  }

  function renderBattleSideCards(side: 'player' | 'enemy', units: CombatUnitRuntime[] | null): string {
    const slots = side === 'player' ? state.playerSlots : state.enemySlots;
    if (slots.length === 0) return '<div style="color:#999;">无单位</div>';
    let h = '';
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;
      const unit = units?.find(u => u.instanceId === slot.entity.instanceId);
      h += renderEntityCard(slot.entity, 0, side, 'battle', getCollapse(), unit);
    }
    return h;
  }

  function renderBattleLog(): string {
    if (state.battleLog.length === 0) return '<span style="color:#999;">等待战斗开始...</span>';
    let h = '';
    for (const evt of state.battleLog) {
      h += formatCombatEventLogHtml(evt);
    }
    return h;
  }

  // ---- 战斗 Tooltip ----

  function bindBattleTooltips() {
    const body = document.getElementById('sb-battle-body');
    if (body) bindSbTooltips(body, getInstance);
  }

  // ---- 动态战斗数值更新（重绘 body 确保所有数值实时） ----

  function doPatchBattleValues() {
    patchBattleValues(
      engine,
      weaponPrevRemaining,
      { get current() { return state.lastTickWallTime; }, set current(v) { state.lastTickWallTime = v; } },
      () => state.combatSpeed,
      { p: 'p', e: 'e' },
      {
        battleLogLength: state.battleLog.length,
        battleFinished: state.battleFinished,
        playerUnits: getCombatUnits('player'),
        enemyUnits: getCombatUnits('enemy'),
        lastLogCountRef: { get current() { return state.lastLogCount; }, set current(v) { state.lastLogCount = v; } },
      },
    );
  }

  // ============================================================
  // 拖拽事件绑定
  // ============================================================

  // ============================================================
  // 物品池事件（pool zone 更新后调用）
  // ============================================================

  function bindPoolEvents() {
    const poolRoot = document.getElementById('sb-pool');
    if (!poolRoot) return;
    bindPoolFilterEvents(poolRoot, getPoolFilterState(), (reason) => {
      if (reason === 'search') {
        updateZone('sb-item-list', renderPoolItemListHtml(getPoolFilterState()));
        bindPoolItemEvents();
      } else {
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      }
    });
    bindPoolItemEvents();
  }

  function bindPoolItemEvents() {
    document.querySelectorAll('.sb-pool-item').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = htmlEl.dataset.type as 'entity' | 'affix';
      const name = htmlEl.querySelector('.item-name')?.textContent || defId;
      htmlEl.addEventListener('pointerdown', (e) => {
        const pe = e as PointerEvent;
        if (pe.button !== 0) return;
        beginPointerDrag(pe, {
          kind: type,
          source: 'pool',
          id: defId,
          defId,
          label: name,
          originEl: htmlEl,
        }, { onCommit: commitPointerDrag });
      });
      htmlEl.addEventListener('mouseenter', (ev) => showSimTooltip(ev as MouseEvent, defId, type));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ============================================================
  // Pointer 拖拽 — 委托绑定 + 数据提交
  // ============================================================

  function bindPointerDragEvents() {
    if (!stablePointerBound) {
      for (const id of ['sb-player-bd', 'sb-enemy-bd'] as const) {
        const bdEl = document.getElementById(id);
        if (!bdEl) continue;
        bdEl.addEventListener('pointerdown', (e) => {
          const pe = e as PointerEvent;
          if (pe.button !== 0) return;
          const handle = (pe.target as HTMLElement).closest('[data-drag-handle]') as HTMLElement | null;
          if (!handle || !bdEl.contains(handle)) return;
          // 折叠按钮上不开始拖
          if ((pe.target as HTMLElement).closest('.sb-card-collapse-btn')) return;
          const instanceId = handle.dataset.instance!;
          const kind = (handle.dataset.kind || 'entity') as 'entity' | 'affix';
          const defId = handle.dataset.defid || '';
          const side = (handle.dataset.side || (id === 'sb-player-bd' ? 'player' : 'enemy')) as 'player' | 'enemy';
          const label = handle.querySelector('.sb-card-header-name')?.textContent
            || handle.textContent?.trim().slice(0, 24)
            || instanceId;
          beginPointerDrag(pe, {
            kind,
            source: 'bd',
            id: instanceId,
            defId,
            side,
            label,
            originEl: handle,
          }, { onCommit: commitPointerDrag });
        });
      }
      stablePointerBound = true;
    }
  }

  function extractItemFromSlots(slots: DeploySlot[], instanceId: string): ItemInstance | null {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].entity.instanceId === instanceId) {
        const item = slots[i].entity;
        slots.splice(i, 1);
        return item;
      }
    }
    for (const s of slots) {
      const fromEntity = extractFromTree(s.entity, instanceId);
      if (fromEntity) {
        pruneFromSlotChildren(s, instanceId);
        return fromEntity;
      }
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === instanceId) {
          const item = s.children[i];
          s.children.splice(i, 1);
          return item;
        }
        const nested = extractFromTree(s.children[i], instanceId);
        if (nested) {
          pruneFromSlotChildren(s, instanceId);
          return nested;
        }
      }
    }
    return null;
  }

  function extractFromTree(root: ItemInstance, id: string): ItemInstance | null {
    if (!root.children) return null;
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i].instanceId === id) {
        const item = root.children[i];
        root.children.splice(i, 1);
        return item;
      }
      const nested = extractFromTree(root.children[i], id);
      if (nested) return nested;
    }
    return null;
  }

  function findParentOf(slots: DeploySlot[], childId: string): ItemInstance | null {
    for (const s of slots) {
      if ((s.entity.children || []).some(c => c.instanceId === childId)) return s.entity;
      const p = findParentInItem(s.entity, childId);
      if (p) return p;
    }
    return null;
  }

  function findParentInItem(parent: ItemInstance, childId: string): ItemInstance | null {
    for (const c of parent.children || []) {
      if (c.instanceId === childId) return parent;
      const p = findParentInItem(c, childId);
      if (p) return p;
    }
    return null;
  }

  function adjustInsertIndex(fromIdx: number, toIdx: number): number {
    if (fromIdx < 0) return toIdx;
    return fromIdx < toIdx ? toIdx - 1 : toIdx;
  }

  function reorderTopLevel(slots: DeploySlot[], instanceId: string, toIdx: number): string | null {
    const fromIdx = slots.findIndex(s => s.entity.instanceId === instanceId);
    if (fromIdx < 0) return '找不到第一层实体';
    const [slot] = slots.splice(fromIdx, 1);
    const idx = adjustInsertIndex(fromIdx, toIdx);
    slots.splice(Math.max(0, Math.min(idx, slots.length)), 0, slot);
    return null;
  }

  function reorderSiblingChildren(
    parent: ItemInstance, instanceId: string, kind: 'entity' | 'affix', toIdx: number,
  ): string | null {
    if (!parent.children) return '无子项';
    const siblings = parent.children.filter(c => c.type === kind);
    const fromIdx = siblings.findIndex(c => c.instanceId === instanceId);
    if (fromIdx < 0) return '找不到同级物品';
    const item = siblings[fromIdx];
    // 在完整 children 中按类型次序重排：先抽出再插入到「同类型序列」的目标位置
    parent.children = parent.children.filter(c => c.instanceId !== instanceId);
    const idx = adjustInsertIndex(fromIdx, toIdx);
    // 映射到完整数组插入点：第 idx 个同类型项之前；若越界则插到最后一个同类型之后
    let insertAt = parent.children.length;
    let seen = 0;
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].type !== kind) continue;
      if (seen === idx) { insertAt = i; break; }
      seen++;
    }
    if (seen < idx) insertAt = parent.children.length;
    parent.children.splice(insertAt, 0, item);
    return null;
  }

  function insertByTypeIndex(
    parent: ItemInstance, item: ItemInstance, kind: 'entity' | 'affix', toIdx: number | undefined,
  ) {
    if (!parent.children) parent.children = [];
    if (toIdx == null) {
      parent.children.push(item);
      return;
    }
    let insertAt = parent.children.length;
    let seen = 0;
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].type !== kind) continue;
      if (seen === toIdx) { insertAt = i; break; }
      seen++;
    }
    parent.children.splice(insertAt, 0, item);
  }

  function commitPointerDrag(session: PointerDragSession, hit: PointerDragHit): string | null {
    if (hit.action === 'invalid') return null;

    // ── 卸到物品池 ──
    if (hit.action === 'remove') {
      if (session.source !== 'bd') return null;
      if (session.kind === 'affix') {
        const parent = findParentOf(state.playerSlots, session.id)
          || findParentOf(state.enemySlots, session.id);
        if (parent) {
          const err = canRemoveAffix(parent, session.id);
          if (err) return err;
        }
      }
      let removed = removeFromSlots(state.playerSlots, session.id);
      if (!removed) removed = removeFromSlots(state.enemySlots, session.id);
      if (removed) refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
      return null;
    }

    if (!hit.side) return '无效目标';
    if (hit.side === 'warehouse') return '无效目标';
    const slots = getSlots(hit.side);

    // ── 同列表重排 ──
    if (hit.action === 'reorder') {
      if (session.source !== 'bd') return null;
      const toIdx = hit.insertIndex ?? 0;
      if (hit.listKind === 'top') {
        const err = reorderTopLevel(slots, session.id, toIdx);
        if (err) return err;
        refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
        return null;
      }
      if (!hit.parentInstanceId) return '缺少父实体';
      const parent = findItemInSlots(slots, hit.parentInstanceId);
      if (!parent) return '父实体不存在';
      // 若当前不在该父下（跨列表被标成 reorder 的边界），走 mount
      const under = (parent.children || []).some(c => c.instanceId === session.id);
      if (!under) {
        // fallthrough to mount via re-label
      } else {
        const err = reorderSiblingChildren(parent, session.id, session.kind, toIdx);
        if (err) return err;
        refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
        return null;
      }
    }

    // ── 挂载（含跨列表移动、从池创建）──
    if (hit.action === 'mount' || hit.action === 'reorder') {
      const parentId = hit.listKind === 'top' ? null : (hit.parentInstanceId ?? null);
      const toIdx = hit.insertIndex;

      if (session.kind === 'affix') {
        if (parentId == null) return '词条需要放入实体';
        const parent = findItemInSlots(slots, parentId);
        if (!parent) return '父实体不存在';
        const parentDef = getEntityDef(parent.defId);
        if (!parentDef) return '未知实体';
        const adef = getAffixDef(session.defId || session.id);
        if (!adef) return '未知词条';

        let item: ItemInstance;
        if (session.source === 'pool') {
          const used = countUsedAffixSlots(parent);
          if (used + adef.slotCost > parentDef.dynamicAffixSlots) {
            return `词条槽位不足(剩${parentDef.dynamicAffixSlots - used},需${adef.slotCost})`;
          }
          const mountErr = canMountAffix(parent, adef.id);
          if (mountErr) return mountErr;
          item = engine.createItem(session.defId, 'affix');
        } else {
          // 跨父移动：先检查原父依赖与目标容量/前置
          const already = (parent.children || []).some(c => c.instanceId === session.id);
          const oldParent = findParentOf(state.playerSlots, session.id)
            || findParentOf(state.enemySlots, session.id);
          if (oldParent && oldParent.instanceId !== parent.instanceId) {
            const rmErr = canRemoveAffix(oldParent, session.id);
            if (rmErr) return rmErr;
          }
          if (!already) {
            const used = countUsedAffixSlots(parent);
            if (used + adef.slotCost > parentDef.dynamicAffixSlots) {
              return `词条槽位不足(剩${parentDef.dynamicAffixSlots - used},需${adef.slotCost})`;
            }
            const mountErr = canMountAffix(parent, adef.id);
            if (mountErr) return mountErr;
          }
          const extracted = extractItemFromSlots(state.playerSlots, session.id)
            || extractItemFromSlots(state.enemySlots, session.id);
          if (!extracted) return '找不到词条';
          item = extracted;
        }
        if (!parent.children) parent.children = [];
        if (toIdx == null) parent.children.push(item);
        else {
          // 插入到同类型序列位置
          let insertAt = parent.children.length;
          let seen = 0;
          for (let i = 0; i < parent.children.length; i++) {
            if (parent.children[i].type !== 'affix') continue;
            if (seen === toIdx) { insertAt = i; break; }
            seen++;
          }
          parent.children.splice(insertAt, 0, item);
        }
        refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
        return null;
      }

      // entity
      if (session.source === 'pool') {
        const poolDef = getEntityDef(session.defId);
        if (!poolDef) return '未知实体';
        const err = canPlaceInSlot(slots, state.round, undefined, parentId, poolDef);
        if (err) return err;
        const newItem = engine.createItem(session.defId, 'entity');
        state.collapsedCards.add(newItem.instanceId);
        for (const c of newItem.children || []) {
          if (c.type === 'entity') state.collapsedCards.add(c.instanceId);
        }
        if (parentId == null) {
          // 子项只留在 entity.children；勿浅拷贝到 slot.children（否则卸下后开战仍合并残留）
          const slot: DeploySlot = { entity: newItem, children: [] };
          if (toIdx == null || toIdx >= slots.length) slots.push(slot);
          else slots.splice(toIdx, 0, slot);
        } else {
          const parent = findItemInSlots(slots, parentId);
          if (!parent) return '父实体不存在';
          insertByTypeIndex(parent, newItem, 'entity', toIdx);
        }
        refreshDeployUI(['player', 'enemy'], true);
        return null;
      }

      // BD 实体移动
      const fromPlayer = !!findItemInSlots(state.playerSlots, session.id);
      const fromEnemy = !!findItemInSlots(state.enemySlots, session.id);
      const fromSide: 'player' | 'enemy' | null = fromPlayer ? 'player' : fromEnemy ? 'enemy' : null;
      if (!fromSide) return '找不到物品';
      if (fromSide !== hit.side) return '不能跨侧移动';

      const existing = findItemInSlots(getSlots(fromSide), session.id)!;
      const def = getEntityDef(existing.defId);
      if (!def) return '未知实体';

      if (parentId == null && slots.some(s => s.entity.instanceId === session.id)) {
        const err = reorderTopLevel(slots, session.id, toIdx ?? slots.length);
        if (err) return err;
        refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
        return null;
      }

      const curParent = findParentOf(getSlots(fromSide), session.id);
      if (parentId && curParent && curParent.instanceId === parentId) {
        const err = reorderSiblingChildren(curParent, session.id, 'entity', toIdx ?? 0);
        if (err) return err;
        refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
        return null;
      }

      const placeErr = canPlaceInSlot(slots, state.round, undefined, parentId, def);
      if (placeErr) return placeErr;

      const moved = extractItemFromSlots(getSlots(fromSide), session.id);
      if (!moved) return '找不到实体';

      if (parentId == null) {
        const slot: DeploySlot = { entity: moved, children: [] };
        if (toIdx == null || toIdx >= slots.length) slots.push(slot);
        else slots.splice(toIdx, 0, slot);
      } else {
        const parent = findItemInSlots(slots, parentId);
        if (!parent) {
          getSlots(fromSide).push({ entity: moved, children: [] });
          refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
          return '父实体不存在';
        }
        insertByTypeIndex(parent, moved, 'entity', toIdx);
      }
      refreshDeployUI(['player', 'enemy'], session.source !== 'bd');
      return null;
    }

    return null;
  }

  function bindTooltipEvents() {
    for (const id of ['sb-player-bd', 'sb-enemy-bd'] as const) {
      const el = document.getElementById(id);
      if (el) bindSbTooltips(el, getInstance);
    }
  }

  function bindCardCollapseEvents() {
    // 卡片整体折叠 — CSS class toggle
    document.querySelectorAll('[data-cardtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.cardtoggle!;
      htmlEl.addEventListener('click', (e) => {
        if (consumeSuppressNextClick() || isPointerDragging()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        const card = htmlEl.closest('.sb-card') as HTMLElement;
        if (!card) return;
        const collapsing = !state.collapsedCards.has(instanceId);
        if (collapsing) state.collapsedCards.add(instanceId);
        else state.collapsedCards.delete(instanceId);
        card.classList.toggle('sb-card-collapsed', collapsing);
        // 更新折叠按钮文字
        const btn = htmlEl.querySelector('.sb-card-collapse-btn');
        if (btn) btn.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 词条区块折叠 — CSS foldable toggle
    document.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.affixblocktoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement;
        if (!foldable) return;
        const collapsing = !state.collapsedAffixBlocks.has(instanceId);
        if (collapsing) state.collapsedAffixBlocks.add(instanceId);
        else state.collapsedAffixBlocks.delete(instanceId);
        foldable.classList.toggle('sb-folded', collapsing);
        const label = htmlEl.querySelector('span');
        if (label) label.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 子实体区块折叠 — CSS foldable toggle + 预览文案切换
    document.querySelectorAll('[data-childblocktoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.childblocktoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement;
        const preview = htmlEl.parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement;
        if (!foldable) return;
        const collapsing = !state.collapsedChildBlocks.has(instanceId);
        if (collapsing) state.collapsedChildBlocks.add(instanceId);
        else state.collapsedChildBlocks.delete(instanceId);
        foldable.classList.toggle('sb-folded', collapsing);
        if (preview) preview.style.display = collapsing ? '' : 'none';
        const label = htmlEl.querySelector('span');
        if (label) label.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 固定词条展开/折叠 — 重新渲染该卡片（结构变化较大）
    document.querySelectorAll('[data-fixtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.fixtoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.collapsedFixedAffixRows.has(instanceId)) state.collapsedFixedAffixRows.delete(instanceId);
        else state.collapsedFixedAffixRows.add(instanceId);
        rebuildSingleCard(instanceId);
      });
    });
    // 动态词条展开/折叠 — 重新渲染该卡片（结构变化较大）
    document.querySelectorAll('[data-dyntoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.dyntoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.collapsedDynAffixRows.has(instanceId)) state.collapsedDynAffixRows.delete(instanceId);
        else state.collapsedDynAffixRows.add(instanceId);
        rebuildSingleCard(instanceId);
      });
    });
  }

  /** 原地重建单张卡片（用于固定/动态词条展开折叠，因为内容结构变化） */
  function rebuildSingleCard(instanceId: string) {
    // 确定卡片属性
    let side: 'player' | 'enemy' = 'player';
    let mode: 'build' | 'battle' = state.inBattle ? 'battle' : 'build';
    let slots: DeploySlot[] = state.playerSlots;
    let item = findItemInSlots(slots, instanceId);
    if (!item) { slots = state.enemySlots; item = findItemInSlots(slots, instanceId); side = 'enemy'; }
    if (!item) return;
    // 必须从该实例自己的 header 向上找最近 .sb-card，禁止 :has()（会命中祖先第一层卡）
    const cardEl = document.querySelector(`[data-cardtoggle="${instanceId}"]`)?.closest('.sb-card') as HTMLElement | null;
    if (!cardEl) return;
    const depth = parseInt(cardEl.dataset.depth || '0');
    let combatUnit: CombatUnitRuntime | null | undefined = undefined;
    if (mode === 'battle') {
      const units = side === 'player' ? getCombatUnits('player') : getCombatUnits('enemy');
      combatUnit = units?.find(u => u.instanceId === item.instanceId);
    }
    const newHtml = renderEntityCard(item, depth, side, mode, getCollapse(), combatUnit);
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    const newCard = temp.firstElementChild as HTMLElement;
    cardEl.replaceWith(newCard);
    // 对新卡片整棵子树重绑折叠与 tooltip
    bindCardCollapseEventsOnCard(newCard);
    bindTooltipEventsOnCard(newCard);
  }

  function bindCardCollapseEventsOnCard(card: HTMLElement) {
    // 嵌套子卡也有 data-cardtoggle，必须全部绑定
    card.querySelectorAll('[data-cardtoggle]').forEach(el => {
      const cardToggle = el as HTMLElement;
      cardToggle.addEventListener('click', (e) => {
        if (consumeSuppressNextClick() || isPointerDragging()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        const instId = cardToggle.dataset.cardtoggle!;
        const targetCard = cardToggle.closest('.sb-card') as HTMLElement | null;
        if (!targetCard) return;
        const collapsing = !state.collapsedCards.has(instId);
        if (collapsing) state.collapsedCards.add(instId);
        else state.collapsedCards.delete(instId);
        targetCard.classList.toggle('sb-card-collapsed', collapsing);
        const btn = cardToggle.querySelector('.sb-card-collapse-btn');
        if (btn) btn.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 词条/子实体 block toggle 同理...
    card.querySelectorAll('[data-affixblocktoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.affixblocktoggle!;
        const foldable = (t as HTMLElement).parentElement?.querySelector('.sb-foldable') as HTMLElement;
        if (!foldable) return;
        const c = !state.collapsedAffixBlocks.has(fi);
        if (c) state.collapsedAffixBlocks.add(fi); else state.collapsedAffixBlocks.delete(fi);
        foldable.classList.toggle('sb-folded', c);
        const lbl = (t as HTMLElement).querySelector('span');
        if (lbl) lbl.textContent = c ? '展开' : '收起';
      });
    });
    card.querySelectorAll('[data-childblocktoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.childblocktoggle!;
        const foldable = (t as HTMLElement).parentElement?.querySelector('.sb-foldable') as HTMLElement;
        const preview = (t as HTMLElement).parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement;
        if (!foldable) return;
        const c = !state.collapsedChildBlocks.has(fi);
        if (c) state.collapsedChildBlocks.add(fi); else state.collapsedChildBlocks.delete(fi);
        foldable.classList.toggle('sb-folded', c);
        if (preview) preview.style.display = c ? '' : 'none';
        const lbl = (t as HTMLElement).querySelector('span');
        if (lbl) lbl.textContent = c ? '展开' : '收起';
      });
    });
    // 固定词条 — rebuildSingleCard 后需重绑
    card.querySelectorAll('[data-fixtoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.fixtoggle!;
        if (state.collapsedFixedAffixRows.has(fi)) state.collapsedFixedAffixRows.delete(fi);
        else state.collapsedFixedAffixRows.add(fi);
        rebuildSingleCard(fi);
      });
    });
    // 动态词条 — rebuildSingleCard 后需重绑
    card.querySelectorAll('[data-dyntoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.dyntoggle!;
        if (state.collapsedDynAffixRows.has(fi)) state.collapsedDynAffixRows.delete(fi);
        else state.collapsedDynAffixRows.add(fi);
        rebuildSingleCard(fi);
      });
    });
  }

  /** 单张卡片（含子树）tooltip 绑定；build / battle 共用 */
  function bindTooltipEventsOnCard(card: HTMLElement) {
    bindTooltipOnRoot(card, getInstance);
  }


  // ============================================================
  // 战斗
  // ============================================================

  /** 从对战池抽取指定回合的 1 个 BD */
  async function drawFromPool(round: number): Promise<DeploySlot[] | null> {
    try {
      const { opponent } = await dataApi.getBattlePool(round);
      if (!opponent || !opponent.bd_json || !Array.isArray(opponent.bd_json)) {
        console.log('[drawFromPool] 池空或数据格式异常', { round, opponent });
        return null;
      }
      console.log('[drawFromPool] 抽取成功', { round, slots: opponent.bd_json.length, opponent: opponent.username });
      return opponent.bd_json as DeploySlot[];
    } catch (e) {
      console.error('[drawFromPool] 请求失败', e);
      return null;
    }
  }

  async function startSimBattle() {
    if (state.playerSlots.length === 0 && state.enemySlots.length === 0) {
      showToast('请至少为一方组建 BD');
      return;
    }
    void _doStartSimBattle();
  }

  async function _doStartSimBattle() {
    // 开战前清空 slot.children，避免历史浅拷贝幽灵子实体被引擎再次合并
    sanitizeSimSlotsBeforeCombat(state.playerSlots);
    sanitizeSimSlotsBeforeCombat(state.enemySlots);

    // 上传双方 BD 到对战池（静默，失败不影响战斗）
    try {
      const r1 = await dataApi.uploadBD(state.round, state.playerSlots);
      console.log('[startSimBattle] 上传玩家 BD 成功', { round: state.round, id: r1.id, slots: state.playerSlots.length });
      const r2 = await dataApi.uploadBD(state.round, state.enemySlots);
      console.log('[startSimBattle] 上传敌人 BD 成功', { round: state.round, id: r2.id, slots: state.enemySlots.length });
    } catch (e) {
      console.error('[startSimBattle] 上传 BD 失败', e);
    }

    state.inBattle = true;
    state.battleFinished = false;
    state.battlePaused = false;
    state.playerWin = null;
    state.battleLog = [];
    state.finalPlayerUnits = null;
    state.finalEnemyUnits = null;
    cancelled = false;

    // 先启动 runSimCombat（内部会设置 combatPlayerUnits），再渲染 UI
    const battlePromise = engine.runSimCombat(
      state.playerSlots,
      state.enemySlots,
      (evt) => {
        if (cancelled) return;
        state.battleLog.push(evt);
        if (!state.battleFinished) {
          battleLogBridge?.pushEvent(evt);
          const logEl = document.getElementById('sb-battle-log');
          if (logEl) logEl.scrollTop = logEl.scrollHeight;
        }
      },
      (win) => {
        if (cancelled) return;
        // 保存快照后再清理
        state.finalPlayerUnits = engine.combatPlayerUnits ? [...engine.combatPlayerUnits] : null;
        state.finalEnemyUnits = engine.combatEnemyUnits ? [...engine.combatEnemyUnits] : null;
        if (state.battleUpdateTimer !== null) {
          cancelAnimationFrame(state.battleUpdateTimer);
          state.battleUpdateTimer = null;
        }
        state.battleFinished = true;
        state.playerWin = win;
        renderZones();
      },
      () => state.battlePaused,
      () => cancelled,
      () => state.combatSpeed,
    );

    // 渲染战斗 UI（此时 runSimCombat 已设置 combatPlayerUnits/combatEnemyUnits，并过了 300ms 初始延迟）
    renderZones();

    // 启动 requestAnimationFrame 轮询（50ms 节流 ≈ 20fps，配合 toFixed(1) 秒显示足够）
    state.lastLogCount = state.battleLog.length;
    state.lastTickWallTime = Date.now();
    weaponPrevRemaining.clear();
    let lastPatchTime = 0;
    const patchLoop = (timestamp: number) => {
      if (timestamp - lastPatchTime >= 50) {
        lastPatchTime = timestamp;
        if (!state.battlePaused && !state.battleFinished) {
          doPatchBattleValues();
        }
      }
      if (!state.battleFinished) {
        state.battleUpdateTimer = requestAnimationFrame(patchLoop);
      }
    };
    state.battleUpdateTimer = requestAnimationFrame(patchLoop);

    try {
      await battlePromise;
    } catch (e) {
      console.error('[startSimBattle] 战斗异常', e);
    } finally {
      if (state.battleUpdateTimer !== null) {
        cancelAnimationFrame(state.battleUpdateTimer);
        state.battleUpdateTimer = null;
      }
    }
  }

  // 初始渲染
  renderZones();
}
