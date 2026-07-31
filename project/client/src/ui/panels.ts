// ============================================================
// 界面渲染 — 含完整战斗阶段界面
// ============================================================

import { GameEngine, CombatEvent, CombatUnitSnapshot, CombatUnitRuntime } from '../game/engine';
import {
  EntityDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, getItemTradeValue,
} from '../game/data';
import { renderPlaybackControlsHtml, bindPlaybackControls } from './playbackControls';
import { bindSplitters, applySplit, loadSplit, applyCombatSplit, loadCombatSplit } from './splitters';
import { createCollapseState, collapseAllOfficialBuild, collapseItemTree } from './build/types';
import { PoolFilterState } from './build/poolList';
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
  /** 商人池筛选（对齐模拟战物品池） */
  shopPoolFilter: PoolFilterState = {
    poolSearch: '',
    entityCatFilter: 'all',
    affixCatFilter: 'all',
    collapsedPoolSections: new Set(),
  };

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

  constructor(engine: GameEngine) {
    this.engine = engine;
    engine.onStateChange = () => this.render();
    engine.onToast = (msg) => this.showToast(msg);
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

  /** 购买成功后：若来自事件则关闭事件 */
  private afterCatalogPurchase(instanceId: string) {
    this.catalogItems.delete(instanceId);
    this.catalogPrices.delete(instanceId);
    if (this.activeEventId) {
      this.engine.state.visitedEventMerchants.push(this.activeEventId);
      this.engine.state.currentEvents = [];
      this.activeEventId = null;
      this.catalogItems.clear();
      this.catalogPrices.clear();
      this.rightPanel = 'event';
      this.render();
    }
  }

  private buildExploreCtx(): OfficialExploreCtx {
    return {
      engine: this.engine,
      collapse: this.exploreCollapse,
      poolFilter: this.shopPoolFilter,
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
    const next = this.engine.continueAfterBattle();
    if (next === 'settlement') {
      this.showingSettlement = true;
      this.renderSettlement();
      return;
    }
    this.rightPanel = 'event';
    this.render();
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

    let rightHtml = '';
    if (this.combatFinished) {
      rightHtml = '<button id="btn-continue-combat" class="fg-btn-primary">继续</button>';
    } else if (inBattle) {
      rightHtml = `
        <span id="fg-battle-header"><span>战斗时间: ${(this.engine.combatTime / 1000).toFixed(1)}s</span></span>
        <span id="hud-playback">${renderPlaybackControlsHtml({
          speed: this.engine.combatSpeed,
          paused: this.combatPaused,
        }, 'hud-btn-pause')}</span>`;
    } else {
      rightHtml = `
        <button id="btn-return-menu">返回主菜单</button>
        <button id="btn-save">手动存档</button>
        <button id="btn-next" class="fg-btn-primary">开始战斗</button>
      `;
    }

    const firstLayerUsed = g.deploySlots.reduce((s, sl) => { const d = getEntityDef(sl.entity.defId); return s + (d?.slotCost || 0); }, 0);
    const firstLayerMax = this.engine.getFirstLayerSlots();
    hud.innerHTML = `
      <div class="hud-item"><span class="hud-label">金币</span><span class="hud-value">${g.gold}</span></div>
      <div class="hud-item"><span class="hud-label">回合</span><span class="hud-value">${g.round}/${g.maxRound}</span></div>
      <div class="hud-item"><span class="hud-label">阶段</span><span class="hud-value">${this.engine.getPhaseLabel()}</span></div>
      <div class="hud-item"><span class="hud-label">一层槽位</span><span class="hud-value">${firstLayerUsed}/${firstLayerMax}</span></div>
      <div class="hud-right">${rightHtml}</div>
    `;

    const btnReturn = document.getElementById('btn-return-menu');
    if (btnReturn) {
      btnReturn.onclick = async () => {
        if (confirm('确定要返回主菜单吗？未保存的进度将丢失。')) {
          if (this.combatUpdateTimer != null) {
            cancelAnimationFrame(this.combatUpdateTimer);
            this.combatUpdateTimer = null;
          }
          disposeOfficialBattleLog(this.buildCombatCtx());
          this.battleLogBridge = null;
          const { navigateToStart } = await import('../main');
          navigateToStart();
        }
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
        const hud = document.getElementById('hud');
        if (hud) {
          bindPlaybackControls({
            root: hud,
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
    // 事件奖励态由 triggerEvent 写 DOM；整页 render 时勿冲掉
    if (this.activeEventId) {
      if (document.getElementById('event-items')) return;
      // DOM 已丢则退出奖励态
      this.activeEventId = null;
      this.catalogItems.clear();
      this.catalogPrices.clear();
    }
    const g = this.engine.state;
    this.catalogItems.clear();
    this.catalogPrices.clear();
    if (!this.engine.isExplore() || g.currentEvents.length === 0) {
      c.innerHTML = '<div class="panel"><div class="panel-title">事件</div><p style="color:var(--fg-text-muted,var(--text-dim));">探险阶段可查看事件</p></div>';
      return;
    }
    const activeEvents = g.currentEvents.filter(eid => !g.visitedEventMerchants.includes(eid));
    if (activeEvents.length === 0) {
      c.innerHTML = '<div class="panel"><div class="panel-title">探险事件</div><p style="color:var(--fg-text-muted,var(--text-dim));">本回合事件已全部访问</p></div>';
      return;
    }
    let h = '<div class="panel"><div class="panel-title">探险事件（选择 1 个）</div>';
    for (const eid of activeEvents)
      h += `<div class="event-card" data-event="${eid}"><h4>${this.engine.getEventName(eid)}</h4><p>${this.eventDesc(eid)}</p></div>`;
    h += '</div>'; c.innerHTML = h;
    c.querySelectorAll('.event-card').forEach(card => card.addEventListener('click', () => this.triggerEvent((card as HTMLElement).dataset.event!)));
  }

  eventDesc(eid: string): string {
    const cap = this.engine.getMerchantValueCap();
    const m: Record<string, string> = {
      good_merchant: `不限件数,实体+词条,价值${cap}~${cap + 3}`,
      entity_merchant: `不限件数,仅实体,价值${cap}~${cap + 3}`,
      affix_merchant: `不限件数,仅词条,价值${cap}~${cap + 3}`,
      discount_merchant: `不限件数,实体+词条,半价`,
      lottery: `不限件数,实体+词条,免费选1件`,
    };
    return m[eid] || '';
  }

  triggerEvent(eid: string) {
    const cap = this.engine.getMerchantValueCap();
    let items: ItemInstance[] = [];

    if (eid === 'good_merchant') {
      items = this.engine.generateShopItems('all').filter(item => {
        const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
        const v = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
        return v >= cap && v <= cap + 3;
      });
    } else if (eid === 'entity_merchant') {
      items = this.engine.generateShopItems('entity').filter(item => {
        const def = getEntityDef(item.defId);
        return def && def.value >= cap && def.value <= cap + 3;
      });
    } else if (eid === 'affix_merchant') {
      items = this.engine.generateShopItems('affix').filter(item => {
        const def = getAffixDef(item.defId);
        return def && Math.abs(def.costValue) >= cap && Math.abs(def.costValue) <= cap + 3;
      });
    } else if (eid === 'discount_merchant') {
      items = this.engine.generateShopItems('all').filter(item => {
        const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
        const v = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
        return v >= 1 && v <= cap;
      });
    } else if (eid === 'lottery') {
      items = this.engine.generateShopItems('all').filter(item => {
        const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
        const v = def ? ('costValue' in def ? Math.abs(def.costValue) : (def as EntityDef).value) : 999;
        return v >= 1 && v <= cap;
      });
    }

    const area = document.getElementById('event-area')!;
    area.innerHTML = `<div class="panel"><div class="panel-title">${this.engine.getEventName(eid)}</div>
      <p class="fg-sell-hint">拖到出场 BD 或下方仓库获取</p>
      <div id="event-items"></div><button class="btn" id="btn-close-ev" style="margin-top:6px;">关闭</button></div>`;
    const itemsDiv = document.getElementById('event-items')!;
    this.activeEventId = eid;
    const prices = new Map<string, number>();
    for (const item of items) {
      const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
      if (!def) continue;
      const basePrice = getItemTradeValue(item);
      const price = eid === 'discount_merchant' ? Math.floor(basePrice / 2) : eid === 'lottery' ? 0 : basePrice;
      prices.set(item.instanceId, price);
    }
    this.setCatalog(items, prices);

    if (items.length === 0) {
      itemsDiv.innerHTML = '<p style="color:var(--text-dim);">当前无可购买的物品</p>';
    } else {
      let rows = '';
      for (const item of items) {
        const price = prices.get(item.instanceId) ?? 0;
        const label = eid === 'lottery' ? '免费' : `${price}金`;
        rows += renderOfficialEventItemRow(item, label);
      }
      itemsDiv.innerHTML = rows;
    }
    document.getElementById('btn-close-ev')!.onclick = () => {
      this.engine.state.visitedEventMerchants.push(eid);
      this.activeEventId = null;
      this.rightPanel = 'event';
      this.catalogItems.clear();
      this.catalogPrices.clear();
      this.render();
    };
    const layoutEl = document.getElementById('main-layout');
    if (layoutEl) bindOfficialExplore(layoutEl, this.buildExploreCtx());
  }

  randomItems(n: number, minV: number, maxV: number, entOnly: boolean, affOnly: boolean): ItemInstance[] {
    this.engine.recomputeItemPool();
    const pool = this.engine.state.itemPool;
    if (pool.length === 0) return [];
    const items: ItemInstance[] = []; const seen = new Set<string>();
    for (let i = 0; i < n * 3 && items.length < n; i++) {
      const did = pool[Math.floor(Math.random() * pool.length)]; if (seen.has(did)) continue;
      const ed = getEntityDef(did); const ad = getAffixDef(did);
      const v = ed ? ed.value : ad ? Math.abs(ad.costValue) : 999;
      if (v < minV || v > maxV) continue;
      if (entOnly && !ed) continue; if (affOnly && !ad) continue;
      seen.add(did); items.push(this.engine.createItem(did, ed ? 'entity' : 'affix'));
    }
    return items;
  }

  // ---- 仓库面板（右下常驻） ----
  renderWarehouse(c: HTMLElement) {
    c.innerHTML = renderOfficialWarehouseHtml(this.buildExploreCtx());
  }

  /** 固定商人：池筛选 + pointer 购售 */
  renderShopFiltered(c: HTMLElement) {
    const items = this.engine.generateShopItems('all');
    this.activeEventId = null;
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
      collapseItemTree(slot.entity, this.combatCollapse);
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
    await this.engine.autoSave();
    await this._doStartCombat();
  }

  /** 匹配完成后开战 */
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
      const battles = this.engine.state.battles;
      if (battles.length > 0) {
        if (this.combatLog.length > 0) {
          battles[battles.length - 1].log = [...this.combatLog];
        }
        void (async () => {
          try {
            await this.engine.autoSave();
            await this.engine.syncHistoryRun('in_progress');
          } catch (e) {
            console.warn('历史归档同步失败', e);
          }
        })();
      }
      this.pendingEnemySlots = null;
      this.pendingAutoWin = false;
      if (this.combatUpdateTimer != null) {
        cancelAnimationFrame(this.combatUpdateTimer);
        this.combatUpdateTimer = null;
      }
      this.render();
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
          gold: g.gold,
          maxRound: g.maxRound,
          showGold: true,
          statusBadge: 'cleared',
          battles: g.battles,
          statusHtml: '<span id="settlement-status" class="fg-settlement-status">正在标记本局已通关…</span>',
          actionsHtml: '<button id="btn-settlement-home" class="fg-btn-primary" disabled>返回主菜单</button>',
        })}
      </div>
    `;

    const root = document.getElementById('settlement-screen')!;
    bindRunReview(root, g.battles);

    const status = document.getElementById('settlement-status')!;
    const homeBtn = document.getElementById('btn-settlement-home') as HTMLButtonElement;

    try {
      const { saves } = await import('../api/client');
      await this.engine.syncHistoryRun('cleared');
      await saves.del();
      this.engine.historyRunId = null;
      status.textContent = '已通关并写入历史，进行中存档已清除';
    } catch (e: any) {
      status.textContent = '历史更新失败：' + (e?.message || e) + '（仍可浏览本页并返回主菜单）';
    }

    homeBtn.disabled = false;
    homeBtn.onclick = async () => {
      this.showingSettlement = false;
      const { navigateToStart } = await import('../main');
      navigateToStart();
    };
  }
}
