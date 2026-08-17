// ============================================================
// 界面渲染 — 含完整战斗阶段界面
// ============================================================

import { GameEngine, CombatEvent, CombatUnitSnapshot, CombatUnitRuntime, getExploreEventDesc } from '../game/engine';
import {
  EntityDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, getItemTradeValue,
} from '../game/data';
import { renderPlaybackControlsHtml, bindPlaybackControls } from './playbackControls';
import { bindSplitters, applySplit, loadSplit, applyCombatSplit, loadCombatSplit } from './splitters';
import { createCollapseState, collapseAllOfficialBuild, collapseItemTree } from './build/types';
import { renderEntityCard } from './build/entityCard';
import { showAppToast } from './toast';
import {
  OfficialExploreCtx,
  renderOfficialBdHtml,
  renderOfficialWarehouseHtml,
  renderOfficialShopHtml,
  renderOfficialEventItemRow,
  bindOfficialExplore,
} from './officialExplore';
import {
  OfficialCombatCtx,
  renderOfficialPlayerCombatHtml,
  renderOfficialEnemyCombatHtml,
  renderOfficialCombatCenterHtml,
  ensureOfficialBattleLog,
  disposeOfficialBattleLog,
  pushOfficialBattleLogEvent,
  bindOfficialCombatInteractions,
  patchOfficialBattleValues,
} from './officialCombat';
import type { BattleLogBridge } from './sim/mountBattleLog';

export class UIManager {
  engine: GameEngine;
  /** 右栏情景 Tab：事件 | 商人（仓库在右下常驻，不进 Tab） */
  rightPanel: 'event' | 'shop' = 'event';

  /** 探险壳卡片折叠（对齐模拟战） */
  exploreCollapse = createCollapseState();

  /**
   * 商人/事件奖励等「尚未入账」的临时实例。
   * findItem 只查仓库与 BD，拖拽购买必须走此表。
   */
  catalogItems: Map<string, ItemInstance> = new Map();
  /** 目录价覆盖（折扣/免费事件）；无则用物品默认价值 */
  catalogPrices: Map<string, number> = new Map();
  /** 正在展示的事件奖励（购买成功后关闭） */
  activeEventId: string | null = null;

  // 战斗状态
  combatEnemies: CombatUnitSnapshot[] = [];
  combatLog: CombatEvent[] = [];
  combatFinished: boolean = false;
  combatResultSummary: { win: boolean; gold: number; autoWin: boolean } | null = null;
  combatUpdateTimer: number | null = null;
  lastTickWallTime: number = 0;
  lastLogCount = 0;
  weaponPrevRemaining: Map<string, number> = new Map();
  /** 匹配后缓存的敌方 BD（避免二次抽池） */
  pendingEnemySlots: DeploySlot[] | null = null;
  /** 开战期间与结束态展示用敌方 BD */
  combatEnemySlots: DeploySlot[] | null = null;
  finalPlayerUnits: CombatUnitRuntime[] | null = null;
  finalEnemyUnits: CombatUnitRuntime[] | null = null;
  pendingAutoWin = false;
  combatPaused = false;
  combatCollapse = createCollapseState();
  battleLogBridge: BattleLogBridge | null = null;
  playbackControlsBound = false;
  /** 通关结算页 */
  showingSettlement = false;
  /** 是否已处于战斗壳（用于进战斗时一次性默认折叠） */
  private combatShellActive = false;
  /** 结束态 history 同步失败时阻断「继续」直至重试成功 */
  private historySyncFailed = false;
  /** 通关删档失败可重试 */
  private settlementDelFailed = false;

  constructor(engine: GameEngine) {
    this.engine = engine;
    engine.onStateChange = () => this.render();
    engine.onToast = (msg) => this.showToast(msg);
    engine.onSaveError = (msg) => this.showToast(msg);
    // 继续游戏 / 进局：BD+仓库可折叠卡默认折叠
    collapseAllOfficialBuild(engine.state.deploySlots, engine.state.warehouse, this.exploreCollapse);
  }

  showToast(msg: string) {
    showAppToast(msg, { host: 'toast' });
  }

  /** 注册商人/事件目录物品（覆盖同批） */
  private setCatalog(items: ItemInstance[], prices?: Map<string, number>) {
    this.catalogItems.clear();
    this.catalogPrices.clear();
    for (const it of items) this.catalogItems.set(it.instanceId, it);
    if (prices) {
      for (const [id, p] of prices) this.catalogPrices.set(id, p);
    }
  }

  /** 购买成功后从 catalog 移除；事件货可继续购买直至点结束 */
  private afterCatalogPurchase(instanceId: string) {
    this.catalogItems.delete(instanceId);
    this.catalogPrices.delete(instanceId);
    this.render();
  }

  private buildExploreCtx(): OfficialExploreCtx {
    return {
      engine: this.engine,
      collapse: this.exploreCollapse,
      catalogItems: this.catalogItems,
      catalogPrices: this.catalogPrices,
      showToast: (msg) => this.showToast(msg),
      onExploreChanged: () => this.render(),
      resolveCatalogItem: (id) => this.catalogItems.get(id),
      afterCatalogPurchase: (id) => this.afterCatalogPurchase(id),
      getCatalogPrice: (id) => this.catalogPrices.get(id),
    };
  }

  private buildCombatCtx(): OfficialCombatCtx {
    return {
      engine: this.engine,
      collapse: this.combatCollapse,
      combatLog: this.combatLog,
      combatFinished: this.combatFinished,
      combatResultSummary: this.combatResultSummary,
      combatEnemySlots: this.combatEnemySlots,
      finalPlayerUnits: this.finalPlayerUnits,
      finalEnemyUnits: this.finalEnemyUnits,
      pendingAutoWin: this.pendingAutoWin,
      weaponPrevRemaining: this.weaponPrevRemaining,
      lastTickWallTime: this.lastTickWallTime,
      lastLogCount: this.lastLogCount,
      battleLogBridge: this.battleLogBridge,
      onContinue: () => this.continueAfterCombatUi(),
      onRebuildSides: () => this.rebuildCombatSides(),
    };
  }

  private syncCombatCtxBridge(ctx: OfficialCombatCtx) {
    this.battleLogBridge = ctx.battleLogBridge;
    this.lastTickWallTime = ctx.lastTickWallTime;
    this.lastLogCount = ctx.lastLogCount;
  }

  private continueAfterCombatUi() {
    void this._continueAfterCombatUi();
  }

  private async _continueAfterCombatUi() {
    if (this.historySyncFailed || this.engine.historySyncPending) {
      try {
        await this.engine.syncHistoryRun('in_progress');
        this.historySyncFailed = false;
        this.engine.historySyncPending = false;
        await this.engine.flushSave();
      } catch (e: any) {
        this.showToast('历史同步仍失败：' + (e?.message || e));
        return;
      }
    }
    if (this.combatUpdateTimer != null) {
      cancelAnimationFrame(this.combatUpdateTimer);
      this.combatUpdateTimer = null;
    }
    disposeOfficialBattleLog(this.buildCombatCtx());
    this.battleLogBridge = null;
    this.combatFinished = false;
    this.combatResultSummary = null;
    this.combatEnemies = [];
    this.combatLog = [];
    this.combatEnemySlots = null;
    this.finalPlayerUnits = null;
    this.finalEnemyUnits = null;
    this.pendingEnemySlots = null;
    this.pendingAutoWin = false;
    const next = this.engine.continueAfterBattle();
    try {
      await this.engine.flushSave();
    } catch (e: any) {
      this.showToast('存档失败：' + (e?.message || e));
      // 关键推进已发生；仍阻断反复点继续乱写——状态已前进
    }
    if (next === 'settlement') {
      this.showingSettlement = true;
      this.renderSettlement();
      return;
    }
    this.rightPanel = 'event';
    this.render();
  }

  /**
   * 读档后按 combatPhase / battles 幂等恢复（实现约定 E）。
   */
  async resumeFromSave() {
    const kind = this.engine.resolveCombatResume();
    if (kind === 'explore') {
      this.render();
      return;
    }
    if (kind === 'rollback_explore') {
      this.engine.rollbackBattleToExplore();
      this.engine.clearCombatSnapshot();
      this.showToast('存档不完整，已回到开战前探险');
      try { await this.engine.flushSave(); } catch { /* toast 已由 onSaveError */ }
      this.render();
      return;
    }
    if (kind === 'end_ui') {
      this.restoreBattleEndUiFromSave();
      this.render();
      return;
    }
    // replay
    this.showToast('检测到未完成的战斗，正在重播…');
    this.pendingAutoWin = this.engine.pendingAutoWin;
    this.pendingEnemySlots = this.engine.pendingEnemyBd
      ? JSON.parse(JSON.stringify(this.engine.pendingEnemyBd))
      : null;
    this.combatEnemySlots = this.pendingEnemySlots
      ? JSON.parse(JSON.stringify(this.pendingEnemySlots))
      : null;
    this.applyCombatDefaultCollapse();
    this.render();
    await this._doStartCombat();
  }

  private restoreBattleEndUiFromSave() {
    const rec = this.engine.getBattleRecordForRound();
    this.pendingAutoWin = this.engine.pendingAutoWin
      || this.engine.combatResultSummary?.autoWin
      || rec?.result === 'auto_win'
      || false;
    const enemyBd = this.engine.pendingEnemyBd ?? rec?.enemyBd ?? null;
    this.pendingEnemySlots = enemyBd ? JSON.parse(JSON.stringify(enemyBd)) : null;
    this.combatEnemySlots = this.pendingEnemySlots
      ? JSON.parse(JSON.stringify(this.pendingEnemySlots))
      : null;
    this.combatFinished = true;
    this.combatResultSummary = this.engine.combatResultSummary ?? (rec ? {
      win: rec.result !== 'loss',
      gold: rec.rewardGold,
      autoWin: rec.result === 'auto_win',
    } : null);
    this.combatLog = rec?.log ? [...rec.log] : [];
    this.historySyncFailed = this.engine.historySyncPending;
    this.applyCombatDefaultCollapse();
  }

  // ======================== 主渲染 ========================
  render() {
    if (this.showingSettlement) {
      this.renderSettlement();
      return;
    }

    const app = document.getElementById('app')!;
    if (!document.getElementById('hud')) {
      app.innerHTML = `
        <div id="hud"></div>
        <div id="main-layout" class="fg-layout">
          <div id="left-zone">
            <div id="deploy-area"></div>
          </div>
          <div id="v-split" class="fg-split-v" title="拖动调整宽度"></div>
          <div id="center-zone" style="display:none">
            <div id="combat-center"></div>
          </div>
          <div id="combat-h-split" class="fg-split-h" style="display:none" title="拖动调整战斗日志高度"></div>
          <div id="right-zone">
            <div id="right-top">
              <div id="right-tabs"></div>
              <div id="event-area"></div>
            </div>
            <div id="h-split" class="fg-split-h" title="拖动调整高度"></div>
            <div id="warehouse-area"></div>
          </div>
        </div>
      `;
      const layoutEl = document.getElementById('main-layout')!;
      applySplit(layoutEl, loadSplit());
      applyCombatSplit(layoutEl, loadCombatSplit());
      bindSplitters(layoutEl);
    }

    const inCombatShell = this.engine.isBattlePhase();
    const center = document.getElementById('center-zone')!;
    const rightTop = document.getElementById('right-top')!;
    const warehouseArea = document.getElementById('warehouse-area')!;
    const vSplit = document.getElementById('v-split')!;
    const hSplit = document.getElementById('h-split')!;
    const combatHSplit = document.getElementById('combat-h-split')!;
    const layout = document.getElementById('main-layout')!;

    if (inCombatShell) {
      center.style.display = '';
      rightTop.style.display = '';
      warehouseArea.style.display = 'none';
      vSplit.style.display = 'none';
      hSplit.style.display = 'none';
      combatHSplit.style.display = '';
      const tabs = document.getElementById('right-tabs');
      if (tabs) tabs.style.display = 'none';
      layout.classList.add('fg-combat');
      applyCombatSplit(layout, loadCombatSplit());
      if (!this.combatShellActive) {
        this.applyCombatDefaultCollapse();
        this.combatShellActive = true;
      }
    } else {
      center.style.display = 'none';
      rightTop.style.display = '';
      warehouseArea.style.display = '';
      vSplit.style.display = '';
      hSplit.style.display = '';
      combatHSplit.style.display = 'none';
      const tabs = document.getElementById('right-tabs');
      if (tabs) tabs.style.display = '';
      layout.classList.remove('fg-combat');
      this.combatShellActive = false;
      applySplit(layout, loadSplit());
    }

    this.renderHUD();
    if (inCombatShell) {
      this.renderPlayerCombatPanel();
      this.renderCombatCenter();
      this.renderEnemyCombatPanel();
      const layoutEl = document.getElementById('main-layout');
      if (layoutEl) bindOfficialCombatInteractions(layoutEl, this.buildCombatCtx());
    } else {
      disposeOfficialBattleLog(this.buildCombatCtx());
      this.battleLogBridge = null;
      this.renderDeploy(false);
      this.renderRightTabs();
      this.renderRightPanels();
      this.renderWarehouse(warehouseArea);
      const layoutEl = document.getElementById('main-layout');
      if (layoutEl) bindOfficialExplore(layoutEl, this.buildExploreCtx());
    }
  }

  // ======================== HUD ========================
  renderHUD() {
    const hud = document.getElementById('hud')!;
    const g = this.engine.state;
    const exploring = this.engine.isExplore();
    const inBattle = this.engine.isBattlePhase();

    const firstLayerUsed = g.deploySlots.reduce((s, sl) => { const d = getEntityDef(sl.entity.defId); return s + (d?.slotCost || 0); }, 0);
    const firstLayerMax = this.engine.getFirstLayerSlots();
    const battleTimeSec = (this.engine.combatTime / 1000).toFixed(1);

    let leftHtml = '';
    let centerExtra = '';
    let rightHtml = '';

    if (this.combatFinished) {
      leftHtml = '<button type="button" class="btn hud-btn-primary" id="btn-continue-combat">继续</button>';
      centerExtra = `<div class="hud-item"><span class="hud-label">战斗时间</span><span class="hud-value" id="fg-battle-header">${battleTimeSec}s</span></div>`;
    } else if (inBattle) {
      centerExtra = `<div class="hud-item"><span class="hud-label">战斗时间</span><span class="hud-value" id="fg-battle-header">${battleTimeSec}s</span></div>`;
      rightHtml = `<span id="hud-playback">${renderPlaybackControlsHtml({
        speed: this.engine.combatSpeed,
        paused: this.combatPaused,
      }, 'hud-btn-pause')}</span>`;
    } else {
      leftHtml = `
        <button type="button" class="btn" id="btn-return-menu">返回主菜单</button>
        <button type="button" class="btn" id="btn-save">手动存档</button>
        <button type="button" class="btn hud-btn-primary" id="btn-next">开始战斗</button>
      `;
      centerExtra = `<div class="hud-item"><span class="hud-label">一层槽位</span><span class="hud-value">${firstLayerUsed}/${firstLayerMax}</span></div>`;
    }

    const centerCore = `
      <div class="hud-item"><span class="hud-label">金币</span><span class="hud-value">${g.gold}</span></div>
      ${g.reserveGold !== 0 || inBattle ? `<div class="hud-item"><span class="hud-label">待结算</span><span class="hud-value">${g.reserveGold >= 0 ? '+' : ''}${g.reserveGold}</span></div>` : ''}
      <div class="hud-item"><span class="hud-label">回合</span><span class="hud-value">${g.round}/${g.maxRound}</span></div>
      <div class="hud-item"><span class="hud-label">阶段</span><span class="hud-value">${this.engine.getPhaseLabel()}</span></div>
      ${centerExtra}
    `;

    hud.innerHTML = `
      <div class="hud-left">${leftHtml}</div>
      <div class="hud-center">${centerCore}</div>
      <div class="hud-right">${rightHtml}</div>
    `;

    const btnReturn = document.getElementById('btn-return-menu');
    if (btnReturn) {
      btnReturn.onclick = async () => {
        if (this.combatUpdateTimer != null) {
          cancelAnimationFrame(this.combatUpdateTimer);
          this.combatUpdateTimer = null;
        }
        disposeOfficialBattleLog(this.buildCombatCtx());
        this.battleLogBridge = null;
        try {
          await this.engine.flushSave();
        } catch (e: any) {
          this.showToast('存档失败，进度可能未保存');
        }
        const { navigateToStart } = await import('../main');
        navigateToStart();
      };
    }

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.onclick = async () => {
        try { await this.engine.manualSave(); this.showToast('存档成功'); }
        catch (e: any) { this.showToast('存档失败: ' + e.message); }
      };
    }

    if (inBattle && !this.combatFinished) {
      if (!this.playbackControlsBound) {
        const hudEl = document.getElementById('hud');
        if (hudEl) {
          bindPlaybackControls({
            root: hudEl,
            pauseBtnId: 'hud-btn-pause',
            getState: () => ({ speed: this.engine.combatSpeed, paused: this.combatPaused }),
            setSpeed: (spd) => { this.engine.combatSpeed = spd; },
            setPaused: (paused) => {
              this.combatPaused = paused;
              if (!paused) this.lastTickWallTime = Date.now();
            },
            onChange: () => this.renderHUD(),
          });
          this.playbackControlsBound = true;
        }
      }
    }

    const btnContinue = document.getElementById('btn-continue-combat');
    if (btnContinue) {
      btnContinue.onclick = () => this.continueAfterCombatUi();
    }

    const btnNext = document.getElementById('btn-next');
    if (btnNext) {
      btnNext.onclick = () => {
        if (!exploring) return;
        if (g.deploySlots.length === 0) { this.showToast('请先配置出场 BD'); return; }
        this.startCombat();
      };
    }
  }

  // ======================== 出场面板 ========================
  renderDeploy(_locked: boolean = false) {
    const area = document.getElementById('deploy-area')!;
    area.innerHTML = renderOfficialBdHtml(this.buildExploreCtx());
  }

  // ======================== 右栏情景 Tab ========================
  renderRightTabs() {
    const el = document.getElementById('right-tabs')!;
    const tabs: Array<{ id: 'event' | 'shop'; label: string }> = [
      { id: 'event', label: '事件' },
      { id: 'shop', label: '商人' },
    ];
    el.innerHTML = tabs.map(t =>
      `<button class="fg-tab ${this.rightPanel === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`
    ).join('');
    el.querySelectorAll('.fg-tab').forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        this.rightPanel = (btn as HTMLElement).dataset.tab as 'event' | 'shop';
        this.render();
      };
    });
  }

  // ======================== 右侧情景面板（非战斗） ========================
  renderRightPanels() {
    const area = document.getElementById('event-area')!;
    if (this.rightPanel === 'shop') this.renderShopFiltered(area);
    else this.renderEventPanel(area);
  }

  // ---- 事件 ----
  renderEventPanel(c: HTMLElement) {
    this.activeEventId = this.engine.state.activeEventId;
    if (this.engine.state.eventStatus === 'active' && this.engine.state.activeEventId) {
      this.renderActiveEventPanel(c, this.engine.state.activeEventId);
      return;
    }
    const g = this.engine.state;
    this.catalogItems.clear();
    this.catalogPrices.clear();
    if (!this.engine.isExplore()) {
      c.innerHTML = '<div class="panel"><div class="panel-title">事件</div><p style="color:var(--fg-text-muted,var(--text-dim));">探险阶段可查看事件</p></div>';
      return;
    }
    if (g.eventStatus === 'done') {
      c.innerHTML = '<div class="panel"><div class="panel-title">探险事件</div><p style="color:var(--fg-text-muted,var(--text-dim));">本回合事件已结束</p></div>';
      return;
    }
    if (g.currentEvents.length === 0) {
      c.innerHTML = '<div class="panel"><div class="panel-title">事件</div><p style="color:var(--fg-text-muted,var(--text-dim));">本回合无事件</p></div>';
      return;
    }
    const cap = this.engine.getMerchantValueCap();
    const nextCap = this.engine.getNextExploreShopCap();
    let h = '<div class="panel"><div class="panel-title">探险事件（选择 1 个）</div>';
    for (const eid of g.currentEvents) {
      h += `<div class="event-card" data-event="${eid}"><h4>${this.engine.getEventName(eid)}</h4><p>${getExploreEventDesc(eid, cap, nextCap)}</p></div>`;
    }
    h += '</div>';
    c.innerHTML = h;
    c.querySelectorAll('.event-card').forEach(card => card.addEventListener('click', () => {
      const eid = (card as HTMLElement).dataset.event!;
      const err = this.engine.beginEvent(eid);
      if (err) this.showToast(err);
      else {
        this.activeEventId = eid;
        this.engine.requestExploreCommitSave();
        this.render();
      }
    }));
  }

  renderActiveEventPanel(c: HTMLElement, eid: string) {
    if (eid === 'work') {
      c.innerHTML = `<div class="panel"><div class="panel-title">打工</div>
        <p>立刻获得 10 金（同次事件仅可领取一次）</p>
        <button class="btn hud-btn-primary" id="btn-ev-work">确认领取</button>
        <button class="btn" id="btn-close-ev" style="margin-left:6px;">结束事件</button></div>`;
      document.getElementById('btn-ev-work')!.onclick = () => {
        const err = this.engine.doWorkEvent();
        if (err) this.showToast(err);
        else {
          this.showToast('+10 金');
          this.engine.requestExploreCommitSave();
          this.render();
        }
      };
      document.getElementById('btn-close-ev')!.onclick = () => {
        this.engine.completeEvent();
        this.engine.requestExploreCommitSave();
        this.render();
      };
      return;
    }
    if (eid === 'invest') {
      c.innerHTML = `<div class="panel"><div class="panel-title">投资</div>
        <p>每次支付 10 金，备用资金池 +15（可多次；下次进入探险时结算）</p>
        <button class="btn hud-btn-primary" id="btn-ev-invest">确认投资</button>
        <button class="btn" id="btn-close-ev" style="margin-left:6px;">结束事件</button></div>`;
      document.getElementById('btn-ev-invest')!.onclick = () => {
        const err = this.engine.doInvestEvent();
        if (err) this.showToast(err);
        else {
          this.showToast('已投资 · 备用池 +15');
          this.engine.requestExploreCommitSave();
          this.render();
        }
      };
      document.getElementById('btn-close-ev')!.onclick = () => {
        this.engine.completeEvent();
        this.engine.requestExploreCommitSave();
        this.render();
      };
      return;
    }
    if (eid === 'nine_thirteen') {
      c.innerHTML = `<div class="panel"><div class="panel-title">九出十三归</div>
        <p>每次立刻 +9 金，备用资金池 −13（可多次借贷；下次进入探险时结算）</p>
        <button class="btn hud-btn-primary" id="btn-ev-nine">确认借贷</button>
        <button class="btn" id="btn-close-ev" style="margin-left:6px;">结束事件</button></div>`;
      document.getElementById('btn-ev-nine')!.onclick = () => {
        const err = this.engine.doNineThirteenEvent();
        if (err) this.showToast(err);
        else {
          this.showToast('+9 金 · 备用池 −13');
          this.engine.requestExploreCommitSave();
          this.render();
        }
      };
      document.getElementById('btn-close-ev')!.onclick = () => {
        this.engine.completeEvent();
        this.engine.requestExploreCommitSave();
        this.render();
      };
      return;
    }
    if (eid === 'craftsman') {
      const slot = this.engine.state.craftsmanSlot;
      let h = `<div class="panel"><div class="panel-title">工匠</div>
        <p class="fg-sell-hint">从仓库或 BD 拖入一个实体；可再拖回仓库/BD 以更换。放入后默认折叠，可展开查看。</p>
        <div id="craftsman-slot" class="fg-craftsman-slot" data-fg-zone="craftsman" style="min-height:48px;margin:8px 0;padding:8px;border:1px dashed var(--fg-border,#ccc);">`;
      if (slot) {
        // 与 BD 一致：快照 + 被动预览，避免只显示模板 HP
        const preview = this.engine.previewBdRuntimes([{ entity: slot, children: [] }]);
        const unit = preview.find(u => u.instanceId === slot.instanceId) || null;
        h += renderEntityCard(slot, 0, 'warehouse', 'build', this.exploreCollapse, unit, [slot]);
      } else {
        h += '<div class="fg-drop-empty">工匠物品区：（空）· 拖入实体</div>';
      }
      h += '</div>';
      const choices: { id: string; label: string }[] = [
        { id: 'hp', label: 'HP 上限 +100' },
        { id: 'hpRegen', label: '生命恢复 +2' },
        { id: 'staminaRegen', label: '耐力恢复 +1' },
        { id: 'maxStamina', label: '耐力上限 +50' },
        { id: 'maxLoad', label: '负重上限 +10000' },
        { id: 'dynamicAffixSlots', label: '动态词条槽 +1' },
        { id: 'entitySlots', label: '子实体槽 +1' },
      ];
      h += '<div style="display:flex;flex-direction:column;gap:4px;">';
      for (const ch of choices) {
        h += `<button class="btn" data-craft="${ch.id}">${ch.label}</button>`;
      }
      h += '</div>';
      h += `<button class="btn" id="btn-close-ev" style="margin-top:8px;">结束事件</button></div>`;
      c.innerHTML = h;
      c.querySelectorAll('[data-craft]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = (btn as HTMLElement).dataset.craft as any;
          const err = this.engine.applyCraftsmanUpgrade(id);
          if (err) this.showToast(err);
          else {
            this.showToast('强化完成');
            this.engine.requestExploreCommitSave();
            this.render();
          }
        });
      });
      document.getElementById('btn-close-ev')!.onclick = () => {
        this.engine.completeEvent();
        this.engine.requestExploreCommitSave();
        this.render();
      };
      // 拖拽/折叠由 render() 末尾统一 bindOfficialExplore，此处勿重复绑定
      return;
    }
    const offers = this.engine.state.eventOffers;
    const prices = this.engine.state.eventOfferPrices;
    const priceMap = new Map(Object.entries(prices).map(([k, v]) => [k, Number(v)]));
    this.setCatalog(offers, priceMap);
    c.innerHTML = `<div class="panel"><div class="panel-title">${this.engine.getEventName(eid)}</div>
      <p class="fg-sell-hint">拖到出场 BD 或下方仓库获取（不可刷新；事件货架不可出售）</p>
      <div id="event-items"></div>
      <button class="btn" id="btn-close-ev" style="margin-top:6px;">结束事件</button></div>`;
    const itemsDiv = document.getElementById('event-items')!;
    if (offers.length === 0) {
      itemsDiv.innerHTML = '<p style="color:var(--text-dim);">当前无可购买的物品</p>';
    } else {
      let rows = '';
      for (const item of offers) {
        const price = prices[item.instanceId] ?? 0;
        rows += renderOfficialEventItemRow(item, `${price}金`);
      }
      itemsDiv.innerHTML = rows;
    }
    document.getElementById('btn-close-ev')!.onclick = () => {
      this.engine.completeEvent();
      this.activeEventId = null;
      this.engine.requestExploreCommitSave();
      this.render();
    };
    // 拖拽/折叠由 render() 末尾统一 bindOfficialExplore
  }

  // ---- 仓库面板（右下常驻） ----
  renderWarehouse(c: HTMLElement) {
    c.innerHTML = renderOfficialWarehouseHtml(this.buildExploreCtx());
  }

  /** 商店：本回合限量货架 */
  renderShopFiltered(c: HTMLElement) {
    this.activeEventId = null;
    const items = this.engine.state.shopOffers;
    this.setCatalog(items);
    c.innerHTML = renderOfficialShopHtml(this.buildExploreCtx());
  }

  /** 更新战斗中动态值（HP/耐力/倒计时），对齐模拟战 patchBattleValues */
  private updateCombatDynamicValues() {
    const ctx = this.buildCombatCtx();
    patchOfficialBattleValues(ctx);
    this.syncCombatCtxBridge(ctx);
  }

  // ======================== 战斗阶段界面 ========================

  /** 左栏：玩家战斗卡片树 */
  renderPlayerCombatPanel() {
    const area = document.getElementById('deploy-area')!;
    area.innerHTML = renderOfficialPlayerCombatHtml(this.buildCombatCtx());
  }

  /** 右栏：敌方战斗卡片 / 空池 */
  renderEnemyCombatPanel() {
    const area = document.getElementById('event-area')!;
    area.innerHTML = renderOfficialEnemyCombatHtml(this.buildCombatCtx());
  }

  // 中栏：结束态摘要 + Solid 战斗日志
  renderCombatCenter() {
    const zone = document.getElementById('combat-center')!;
    // 换壳时先 dispose 旧 bridge，再写入新 host
    disposeOfficialBattleLog(this.buildCombatCtx());
    this.battleLogBridge = null;
    zone.innerHTML = renderOfficialCombatCenterHtml(this.buildCombatCtx());
    const ctx = this.buildCombatCtx();
    ensureOfficialBattleLog(ctx);
    this.syncCombatCtxBridge(ctx);
  }

  /** 仅刷新两侧卡片（折叠重建），不重挂日志 */
  private rebuildCombatSides() {
    this.renderPlayerCombatPanel();
    this.renderEnemyCombatPanel();
    const layoutEl = document.getElementById('main-layout');
    if (layoutEl) bindOfficialCombatInteractions(layoutEl, this.buildCombatCtx());
  }

  /** @deprecated 日志已迁入 renderCombatCenter */
  renderCombatLogPanel() {
    this.renderCombatCenter();
  }

  /** 进入战斗壳：友方/敌方可折叠卡全部默认折叠 */
  private applyCombatDefaultCollapse() {
    this.combatCollapse = createCollapseState();
    collapseAllOfficialBuild(this.engine.state.deploySlots, [], this.combatCollapse);
    for (const slot of this.combatEnemySlots || []) {
      collapseItemTree(slot.entity, this.combatCollapse, 'enemy');
    }
  }

  // ======================== 开战 ========================

  /** 正式战：进入战斗回合 → 匹配 → 开战；网络异常则退回探险 */
  async startCombat() {
    if (!this.engine.isExplore()) return;

    this.engine.enterBattleRound();
    this.showToast('正在匹配对手…');

    const prep = await this.engine.prepareOfficialBattle();
    if (prep.networkError) {
      this.engine.rollbackBattleToExplore();
      this.showToast(prep.errorMessage || '网络异常，可重试开始战斗');
      this.pendingEnemySlots = null;
      this.pendingAutoWin = false;
      this.combatEnemySlots = null;
      this.render();
      return;
    }

    this.pendingAutoWin = prep.autoWin;
    this.pendingEnemySlots = prep.enemySlots;
    this.combatEnemySlots = prep.enemySlots ? JSON.parse(JSON.stringify(prep.enemySlots)) : null;
    this.applyCombatDefaultCollapse();

    this.engine.beginBattlePending({
      enemyBd: prep.enemySlots,
      autoWin: prep.autoWin,
    });
    try {
      await this.engine.flushSave();
    } catch (e: any) {
      this.engine.rollbackBattleToExplore();
      this.engine.clearCombatSnapshot();
      this.pendingEnemySlots = null;
      this.pendingAutoWin = false;
      this.combatEnemySlots = null;
      this.showToast('开战存档失败：' + (e?.message || e));
      this.render();
      return;
    }
    await this._doStartCombat();
  }

  /** 匹配完成后开战（含读档重播） */
  private async _doStartCombat() {
    this.combatLog = [];
    this.combatFinished = false;
    this.combatResultSummary = null;
    this.combatPaused = false;
    this.engine.combatSpeed = 1;
    this.finalPlayerUnits = null;
    this.finalEnemyUnits = null;
    this.lastLogCount = 0;
    this.weaponPrevRemaining.clear();
    this.historySyncFailed = false;

    const onEvent = (evt: CombatEvent) => {
      this.combatLog.push(evt);
      pushOfficialBattleLogEvent(this.buildCombatCtx(), evt);
      this.lastTickWallTime = Date.now();
    };
    const onEnd = (win: boolean, gold: number) => {
      // 引擎 finally 会清空 runtime，先快照
      this.finalPlayerUnits = this.engine.combatPlayerUnits
        ? this.engine.combatPlayerUnits.map(u => ({ ...u, weapons: u.weapons.map(w => ({ ...w })) }))
        : null;
      this.finalEnemyUnits = this.engine.combatEnemyUnits
        ? this.engine.combatEnemyUnits.map(u => ({ ...u, weapons: u.weapons.map(w => ({ ...w })) }))
        : null;
      if (win) this.showToast(this.pendingAutoWin ? `空池自动获胜 · +${gold}金币` : `战斗胜利！+${gold}金币`);
      else this.showToast('战斗失败');
      this.combatFinished = true;
      this.combatResultSummary = { win, gold, autoWin: this.pendingAutoWin };
      this.engine.markBattleEnd({ win, gold, autoWin: this.pendingAutoWin });
      const battles = this.engine.state.battles;
      if (battles.length > 0 && this.combatLog.length > 0) {
        battles[battles.length - 1].log = [...this.combatLog];
      }
      // 结束态：先 flush 存档，再旁路 sync history；勿清 engine.pendingEnemyBd
      this.pendingEnemySlots = null;
      void (async () => {
        try {
          await this.engine.flushSave();
        } catch (e: any) {
          this.showToast('结束态存档失败：' + (e?.message || e));
          this.render();
          return;
        }
        try {
          await this.engine.syncHistoryRun('in_progress');
          this.historySyncFailed = false;
          this.engine.historySyncPending = false;
        } catch (e) {
          console.warn('历史归档同步失败', e);
          this.historySyncFailed = true;
          this.engine.historySyncPending = true;
          this.showToast('历史同步失败，点继续时将重试');
          try { await this.engine.flushSave(); } catch { /* ignore */ }
        }
        if (this.combatUpdateTimer != null) {
          cancelAnimationFrame(this.combatUpdateTimer);
          this.combatUpdateTimer = null;
        }
        this.render();
      })();
    };

    if (this.pendingAutoWin || !this.pendingEnemySlots) {
      this.render();
      this.engine.settleOfficialAutoWin(onEnd, this.combatLog);
      return;
    }

    // 先启动战斗（同步阶段会写入 combat*Units），再渲染卡片树
    const battlePromise = this.engine.runCombatWithSides(
      this.engine.state.deploySlots,
      this.pendingEnemySlots,
      onEvent,
      onEnd,
      () => this.combatPaused,
      undefined,
      () => this.engine.combatSpeed,
    );

    this.render();

    this.lastTickWallTime = Date.now();
    this.lastLogCount = this.combatLog.length;
    let lastPatchTime = 0;
    const patchLoop = (timestamp: number) => {
      if (timestamp - lastPatchTime >= 50) {
        lastPatchTime = timestamp;
        if (!this.combatPaused && !this.combatFinished) {
          this.updateCombatDynamicValues();
        }
      }
      if (!this.combatFinished) {
        this.combatUpdateTimer = requestAnimationFrame(patchLoop);
      }
    };
    this.combatUpdateTimer = requestAnimationFrame(patchLoop);

    try {
      await battlePromise;
    } finally {
      if (this.combatUpdateTimer != null) {
        cancelAnimationFrame(this.combatUpdateTimer);
        this.combatUpdateTimer = null;
      }
    }
  }

  // ======================== 通关结算 ========================
  async renderSettlement() {
    const app = document.getElementById('app')!;
    const g = this.engine.state;
    const {
      countWinsLosses,
      resolveTotalGoldGained,
      renderRunReviewShellHtml,
      bindRunReview,
    } = await import('./runReview');
    const wl = countWinsLosses(g.battles);

    app.innerHTML = `
      <div id="settlement-screen" class="fg-settlement fg-settlement-pane">
        ${renderRunReviewShellHtml({
          title: '通关结算',
          wins: wl.wins,
          losses: wl.losses,
          totalRewardGold: resolveTotalGoldGained({
            totalGoldGained: g.totalGoldGained,
            battles: g.battles,
            maxRound: g.maxRound,
            currentRound: g.round,
          }),
          maxRound: g.maxRound,
          showSettlementStats: true,
          statusBadge: 'cleared',
          battles: g.battles,
          statusHtml: '<span id="settlement-status" class="fg-settlement-status">正在标记本局已通关…</span>',
          leadingHtml: '<button type="button" id="btn-settlement-home" class="btn" disabled>返回主菜单</button><button type="button" id="btn-settlement-retry-del" class="btn" style="display:none;margin-left:8px;">重试删除存档</button>',
        })}
      </div>
    `;

    const root = document.getElementById('settlement-screen')!;
    bindRunReview(root, g.battles);

    const status = document.getElementById('settlement-status')!;
    const homeBtn = document.getElementById('btn-settlement-home') as HTMLButtonElement;
    const retryDelBtn = document.getElementById('btn-settlement-retry-del') as HTMLButtonElement;

    const tryDeleteSave = async (): Promise<boolean> => {
      const { saves } = await import('../api/client');
      try {
        await saves.del();
        this.engine.historyRunId = null;
        this.settlementDelFailed = false;
        retryDelBtn.style.display = 'none';
        status.textContent = '已通关并写入历史，进行中存档已清除';
        return true;
      } catch (e: any) {
        this.settlementDelFailed = true;
        retryDelBtn.style.display = '';
        status.textContent = '历史已通关，但删除进行中存档失败：' + (e?.message || e) + '（请重试，否则「继续游戏」仍可进入）';
        return false;
      }
    };

    try {
      await this.engine.syncHistoryRun('cleared');
      await tryDeleteSave();
    } catch (e: any) {
      status.textContent = '历史更新失败：' + (e?.message || e) + '（未删档；仍可浏览本页并返回主菜单）';
    }

    homeBtn.disabled = false;
    retryDelBtn.onclick = () => { void tryDeleteSave(); };
    homeBtn.onclick = async () => {
      if (this.settlementDelFailed) {
        const ok = await tryDeleteSave();
        if (!ok) {
          // 仍允许回主菜单，但已提示风险
        }
      }
      this.showingSettlement = false;
      const { navigateToStart } = await import('../main');
      navigateToStart();
    };
  }
}
