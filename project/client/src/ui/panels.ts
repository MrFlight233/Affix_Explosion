// ============================================================
// 界面渲染 — 含完整战斗阶段界面
// ============================================================

import { GameEngine, CombatEvent, CombatUnitSnapshot, CombatUnitRuntime, PlaybackSpeed } from '../game/engine';
import {
  EntityDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, isStarter, hasEntitySlots, getEffectiveEntitySlots, getEntityCategory,
} from '../game/data';
import { makeDraggable, makeDropZone, DragPayload } from './dragDrop';
import { showTooltip, hideTooltip } from './tooltip';
import { showCombatPreview } from './combatPreview';
import { renderPlaybackControlsHtml } from './playbackControls';

export class UIManager {
  engine: GameEngine;
  rightPanel: string | null = null;

  // 商店筛选状态
  shopFilter: 'all' | 'entity' | 'affix' = 'all';

  // 词条展开/收起状态（纯 UI，不入引擎）
  collapsedAffixRows: Set<string> = new Set();

  // 战斗状态
  combatEnemies: CombatUnitSnapshot[] = [];
  combatLog: CombatEvent[] = [];
  combatFinished: boolean = false;
  combatUpdateTimer: any = null;
  lastTickWallTime: number = 0;
  weaponPrevRemaining: Map<string, number> = new Map();
  /** 预览确认后缓存的敌方 BD（避免二次抽池） */
  pendingEnemySlots: DeploySlot[] | null = null;
  pendingAutoWin = false;
  combatPaused = false;

  constructor(engine: GameEngine) {
    this.engine = engine;
    engine.onStateChange = () => this.render();
    engine.onToast = (msg) => this.showToast(msg);
  }

  showToast(msg: string) {
    let toast = document.getElementById('toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ======================== 主渲染 ========================
  render() {
    const app = document.getElementById('app')!;
    if (!document.getElementById('hud')) {
      app.innerHTML = `
        <div id="hud"></div>
        <div id="main-layout">
          <div id="left-zone">
            <div id="deploy-area"></div>
            <div id="quick-warehouse">
              <div class="qw-header" id="qw-toggle">仓库简视 [展开]</div>
              <div class="qw-body" id="qw-body"></div>
            </div>
            <div id="left-btns"></div>
          </div>
          <div id="right-zone">
            <div id="event-area"></div>
            <div id="sell-zone"></div>
          </div>
        </div>
      `;
      document.getElementById('qw-toggle')!.addEventListener('click', () => {
        this.engine.state.quickWarehouseCollapsed = !this.engine.state.quickWarehouseCollapsed;
        this.render();
      });
    }

    const isCombat = this.engine.state.phase === 2;
    this.renderHUD();
    if (isCombat) {
      this.renderPlayerCombatPanel();
      this.renderEnemyCombatPanel();
      this.renderCombatLogPanel();
    } else {
      this.renderDeploy(false);
      this.renderQuickWarehouse();
      this.renderLeftButtons(false);
      this.renderRightPanels();
    }
  }

  // ======================== HUD ========================
  renderHUD() {
    const hud = document.getElementById('hud')!;
    const g = this.engine.state;
    const canSave = g.phase === 1;

    let rightHtml = '';
    if (this.combatFinished) {
      rightHtml = '<button id="btn-continue-combat">继续</button>';
    } else if (g.phase === 2) {
      rightHtml = `<span id="hud-playback">${renderPlaybackControlsHtml({
        speed: this.engine.combatSpeed,
        paused: this.combatPaused,
      }, 'hud-btn-pause')}</span>`;
    } else {
      rightHtml = [
        canSave ? '<button id="btn-save">存档</button>' : '',
        `<button id="btn-next">${g.phase === 1 && g.deploySlots.length > 0 ? '开始战斗' : '下一阶段'}</button>`,
      ].filter(Boolean).join('');
    }

    const firstLayerUsed = g.deploySlots.reduce((s, sl) => { const d = getEntityDef(sl.entity.defId); return s + (d?.slotCost || 0); }, 0);
    const firstLayerMax = this.engine.getFirstLayerSlots();
    hud.innerHTML = `
      <div class="hud-item"><span class="hud-label">金币</span><span class="hud-value">${g.gold}</span></div>
      <div class="hud-item"><span class="hud-label">回合</span><span class="hud-value">${g.round}</span></div>
      <div class="hud-item"><span class="hud-label">阶段</span><span class="hud-value">${this.engine.getPhaseLabel()}</span></div>
      <div class="hud-item"><span class="hud-label">一层槽位</span><span class="hud-value">${firstLayerUsed}/${firstLayerMax}</span></div>
      <div class="hud-right">
        <button id="btn-return-menu">返回主菜单</button>
        ${rightHtml}
      </div>
    `;

    // 返回主菜单
    const btnReturn = document.getElementById('btn-return-menu');
    if (btnReturn) {
      btnReturn.onclick = async () => {
        if (confirm('确定要返回主菜单吗？未保存的进度将丢失。')) {
          if (this.combatUpdateTimer) { clearInterval(this.combatUpdateTimer); this.combatUpdateTimer = null; }
          const { navigateToStart } = await import('../main');
          navigateToStart();
        }
      };
    }

    if (canSave) {
      const btnSave = document.getElementById('btn-save');
      if (btnSave) btnSave.onclick = () => this.showSavePanel();
    }

    // 战斗中：倍速 / 暂停
    if (g.phase === 2 && !this.combatFinished) {
      document.querySelectorAll('#hud-playback [data-speed]').forEach(el => {
        (el as HTMLElement).onclick = () => {
          const raw = (el as HTMLElement).dataset.speed!;
          const spd: PlaybackSpeed = raw === 'max' ? 'max' : (Number(raw) as 1 | 2 | 4);
          this.engine.combatSpeed = spd;
          this.renderHUD();
        };
      });
      const pauseBtn = document.getElementById('hud-btn-pause');
      if (pauseBtn) {
        pauseBtn.onclick = () => {
          this.combatPaused = !this.combatPaused;
          if (!this.combatPaused) this.lastTickWallTime = Date.now();
          this.renderHUD();
        };
      }
    }
    const btnContinue = document.getElementById('btn-continue-combat');
    if (btnContinue) {
      btnContinue.onclick = () => {
        if (this.combatUpdateTimer) { clearInterval(this.combatUpdateTimer); this.combatUpdateTimer = null; }
        this.combatFinished = false;
        this.combatEnemies = [];
        this.combatLog = [];
        this.engine.nextPhase();
        this.render();
      };
    }
    const btnNext = document.getElementById('btn-next');
    if (btnNext) {
      btnNext.onclick = () => {
        if (g.phase === 1 && g.deploySlots.length === 0) { this.showToast('请先配置出场 BD'); return; }
        if (g.phase === 1) { this.startCombat(); }
        else { this.engine.nextPhase(); }
      };
    }
  }

  /** 递归渲染实体树：自身 + children + 嵌套 drop zone */
  private renderEntityTree(item: ItemInstance, depth: number, slotIdx: number, parentId: string | null): string {
    const isEntity = item.type === 'entity';
    const def = isEntity ? getEntityDef(item.defId) : getAffixDef(item.defId);
    if (!def) return '';

    const cls = !isEntity ? 'affix' : isStarter(def as EntityDef) ? 'starter' : 'gear';
    const indent = depth > 0 ? ` nested-${Math.min(depth, 3)}` : '';
    const dzId = isEntity && hasEntitySlots(def as EntityDef)
      ? ` id="dz-${item.instanceId}"` : '';
    const itemId = ` id="item-${item.instanceId}"`;

    let html = '';

    if (isEntity) {
      const edef = def as EntityDef;
      html += `<div class="item-row ${cls}${indent}"${itemId}>`;
      html += `<span class="item-name" data-defid="${edef.id}" data-type="entity">${edef.name}</span>`;
      if (isStarter(edef)) {
        // 启动端：显示 HP / 槽位 / 耐力 / 负重
        let load = 0;
        for (const c of (item.children || [])) { const cd = getEntityDef(c.defId); if (cd) load += cd.weight; }
        const over = load > edef.maxLoad;
        html += `<span class="item-stat">HP:${edef.hp} 槽位:${edef.entitySlots}</span>`;
        html += `<span class="item-stat">耐力:${edef.maxStamina}/${edef.staminaRegen}/s 负重:${load}/${edef.maxLoad}</span>`;
        if (over) html += `<span class="item-stat warn">超重</span>`;
      } else if (edef.isActive) {
        // 可触发动作参数
        html += `<span class="item-stat">伤害:${edef.damage} 耗时:${edef.actionTime}ms 耐耗:${edef.staminaCost} ${edef.targetType}</span>`;
      } else {
        // 被动加成
        if (edef.damageBonus) html += `<span class="item-stat">伤害加成:${edef.damageBonus}</span>`;
        
        if (edef.staminaRegenerationBonus) html += `<span class="item-stat">耐恢:${edef.staminaRegenerationBonus}</span>`;
        if (edef.staminaBonus) html += `<span class="item-stat">耐力:${edef.staminaBonus}</span>`;
        if (edef.hpRegenerationBonus) html += `<span class="item-stat">命恢:${edef.hpRegenerationBonus}</span>`;
        if (edef.hpBonus) html += `<span class="item-stat">生命:${edef.hpBonus}</span>`;
        if (hasEntitySlots(edef)) html += `<span class="item-stat">内槽:${getEffectiveEntitySlots(edef)}</span>`;
        html += `<span class="item-stat">重:${edef.weight}</span>`;
      }
      html += `<span class="item-value">价${edef.value}</span></div>`;
    } else {
      // 词条
      const adef = def as any;
      html += `<div class="item-row ${cls}${indent}"${itemId}>`;
      html += `<span class="item-name" data-defid="${adef.id}" data-type="affix">${adef.name}</span>`;
      html += `<span class="item-stat">${adef.effect}</span>`;
      html += `<span class="item-value">价${Math.abs(adef.costValue)}</span></div>`;
    }

    // 分离词条子项和实体子项
    const allChildren = item.children || [];
    const affixChildren = allChildren.filter(c => c.type === 'affix');
    const entityChildren = allChildren.filter(c => c.type === 'entity');

    // 词条展开/收起切换（仅当有词条子项时）
    if (affixChildren.length > 0) {
      const collapsed = this.collapsedAffixRows.has(item.instanceId);
      const toggleId = `affix-toggle-${item.instanceId}`;
      html += `<div class="item-row affix-toggle nested-${Math.min(depth + 1, 3)}" id="${toggleId}">`;
      html += `<span>${collapsed ? '[展开词条]' : '[收起词条]'} (${affixChildren.length})</span>`;
      if (collapsed) {
        // 收起：一行显示词条名称摘要
        const names = affixChildren.map(c => {
          const adef = getAffixDef(c.defId);
          return adef ? adef.name : c.defId;
        }).join('、');
        html += `<span class="item-stat" style="margin-left:6px;">词条: ${names}</span>`;
      }
      html += '</div>';

      // 展开时渲染每个词条
      if (!collapsed) {
        for (const ac of affixChildren) {
          html += this.renderEntityTree(ac, depth + 1, slotIdx, item.instanceId);
        }
      }
    }

    // 如果该实体有 entitySlots，渲染嵌套 drop zone（只放实体子项）
    if (isEntity && hasEntitySlots(def as EntityDef)) {
      html += `<div class="drop-zone"${dzId} style="margin-left:${(depth + 1) * 16}px;min-height:24px;">`;
      if (entityChildren.length > 0) {
        for (const child of entityChildren) {
          html += this.renderEntityTree(child, depth + 1, slotIdx, item.instanceId);
        }
      }
      html += '</div>';
    } else if (entityChildren.length > 0 && !hasEntitySlots(def as EntityDef)) {
      // 有实体子项但没有 slot 容量（兼容）
      for (const child of entityChildren) {
        html += this.renderEntityTree(child, depth + 1, slotIdx, item.instanceId);
      }
    }

    return html;
  }

  /** 拖拽排序：根据放下位置计算插入索引并执行 reorder */
  private handleReorderDrop(
    payload: DragPayload,
    slotIdx: number,
    parentInstanceId: string | null,
    siblings: NodeListOf<Element>,
    event: DragEvent,
  ): string | null {
    const item = this.engine.findItem(payload.instanceId);
    if (!item) return '物品不存在';

    const dropY = event.clientY;
    let insertIdx = -1;

    for (let i = 0; i < siblings.length; i++) {
      const rect = siblings[i].getBoundingClientRect();
      if (dropY < rect.top + rect.height / 2) {
        insertIdx = i;
        break;
      }
    }

    // Find the current index of the dragged item
    const childrenArr = parentInstanceId === null
      ? this.engine.state.deploySlots[slotIdx]?.children
      : null; // We need to search...

    // For simplicity: always do a move first, then reorder based on position
    // If the item is already in the same parent, just reorder
    if (payload.parentInstanceId === parentInstanceId && payload.slotIdx === slotIdx) {
      // Same parent reorder
      const fromIdx = payload.childIdx ?? 0;
      this.engine.reorderChildren(parentInstanceId, slotIdx, fromIdx, insertIdx);
      return null;
    }

    // Different parent: move to this parent first, then reorder
    const err = this.engine.moveToDeploy(item, slotIdx, parentInstanceId);
    if (err) return err;
    // Now the item is at the end, move it to the right position
    // The children array length changed, so find the new index
    const newChildren = parentInstanceId === null
      ? this.engine.state.deploySlots[slotIdx].children
      : [];
    if (newChildren.length > 0 && insertIdx >= 0 && insertIdx < newChildren.length) {
      this.engine.reorderChildren(parentInstanceId, slotIdx, newChildren.length - 1, insertIdx);
    }
    return null;
  }

  /** 递归绑定拖拽事件：给每个实体行和 drop zone 绑定 */
  private bindDeployDragEvents() {
    const g = this.engine.state;

    // 顶层 drop zone（新增启动端）
    const top = document.getElementById('deploy-top-drop');
    if (top) makeDropZone(top, 'deploy-top', undefined, (p) => {
      const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
      if (p.source === 'shop') return this.engine.buyAndEquip(item, undefined);
      return this.engine.moveToDeploy(item, undefined);
    });

    // 递归遍历所有 deploySlots 及其子树
    const bindRecursive = (item: ItemInstance, slotIdx: number, parentId: string | null, source: string) => {
      // 使实体行可拖拽
      const row = document.getElementById(`item-${item.instanceId}`);
      if (row) {
        row.draggable = true;
        makeDraggable(row, {
          instanceId: item.instanceId,
          source: source as any,
          slotIdx,
          parentInstanceId: parentId,
        });
      }

      // 如果有 entitySlots，绑定子 drop zone
      const def = getEntityDef(item.defId);
      if (def && hasEntitySlots(def)) {
        const dz = document.getElementById(`dz-${item.instanceId}`);
        if (dz) {
          makeDropZone(dz, 'deploy-slot', slotIdx, (p, _z, tgt) => {
            const dragItem = this.engine.findItem(p.instanceId);
            if (!dragItem) return '物品不存在';
            if (p.source === 'shop') return this.engine.buyAndEquip(dragItem, tgt, item.instanceId);
            return this.engine.moveToDeploy(dragItem, tgt, item.instanceId);
          });
        }
      }

      // 递归子项
      if (item.children) {
        for (const child of item.children) {
          bindRecursive(child, slotIdx, item.instanceId, 'deploy-slot');
        }
      }
    };

    for (let si = 0; si < g.deploySlots.length; si++) {
      const slot = g.deploySlots[si];

      // 启动端实体行
      const er = document.getElementById(`item-${slot.entity.instanceId}`);
      if (er) {
        er.draggable = true;
        makeDraggable(er, {
          instanceId: slot.entity.instanceId,
          source: 'deploy-top',
          slotIdx: si,
          parentInstanceId: null,
        });
      }

      // 启动端子 drop zone（如果有 entitySlots）
      const edef = getEntityDef(slot.entity.defId);
      if (edef && hasEntitySlots(edef)) {
        const dz = document.getElementById(`dz-${slot.entity.instanceId}`);
        if (dz) {
          makeDropZone(dz, 'deploy-slot', si, (p, _z, tgt) => {
            const dragItem = this.engine.findItem(p.instanceId);
            if (!dragItem) return '物品不存在';
            if (p.source === 'shop') return this.engine.buyAndEquip(dragItem, tgt, slot.entity.instanceId);
            return this.engine.moveToDeploy(dragItem, tgt, slot.entity.instanceId);
          });
        }
      }

      // 递归处理 entity 自身的 children（容器内嵌套）
      if (slot.entity.children) {
        for (const child of slot.entity.children) {
          bindRecursive(child, si, slot.entity.instanceId, 'deploy-slot');
        }
      }

      // 递归处理 slot.children（启动端直属）
      for (const child of slot.children) {
        bindRecursive(child, si, null, 'deploy-slot');
      }
    }
  }

  // ======================== 出场面板 ========================
  renderDeploy(locked: boolean = false) {
    const area = document.getElementById('deploy-area')!;
    const g = this.engine.state;
    let html = `<div class="panel"><div class="panel-title">出场面板${locked ? ' [锁定]' : ''}</div>`;
    html += '<div class="drop-zone" id="deploy-top-drop" style="min-height:40px;">';
    if (g.deploySlots.length === 0) html += '<span style="color:var(--text-dim);font-size:12px;">拖拽启动端至此</span>';
    html += '</div>';

    for (let si = 0; si < g.deploySlots.length; si++) {
      const slot = g.deploySlots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef || !isStarter(edef)) continue;

      html += `<div class="drop-zone" id="deploy-slot-${si}" style="margin-top:4px;min-height:36px;">`;

      // 渲染启动端实体（depth=0，无 parent）
      html += this.renderEntityTree(slot.entity, 0, si, null);

      // 渲染 slot.children（启动端直属装备/词条）
      for (const child of slot.children) {
        html += this.renderEntityTree(child, 1, si, null);
      }

      html += '</div>';
    }
    html += '</div>';
    area.innerHTML = html;

    if (!locked) {
      // slot 级 drop zone
      for (let si = 0; si < g.deploySlots.length; si++) {
        const el = document.getElementById(`deploy-slot-${si}`);
        if (el) makeDropZone(el, 'deploy-slot', si, (p, _z, tgt, e) => {
          const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
          // 检测同父区域 → reorder
          if (p.parentInstanceId === null && p.slotIdx === si && p.source !== 'shop') {
            const siblings = el.querySelectorAll(':scope > .item-row, :scope > .drop-zone');
            return this.handleReorderDrop(p, si, null, siblings, e as DragEvent);
          }
          if (p.source === 'shop') return this.engine.buyAndEquip(item, tgt);
          return this.engine.moveToDeploy(item, tgt);
        });
      }
      this.bindDeployDragEvents();
    }

    // 绑定词条展开/收起切换事件
    document.querySelectorAll('[id^="affix-toggle-"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.id.replace('affix-toggle-', '');
      htmlEl.addEventListener('click', () => {
        if (this.collapsedAffixRows.has(instanceId)) {
          this.collapsedAffixRows.delete(instanceId);
        } else {
          this.collapsedAffixRows.add(instanceId);
        }
        this.render();
      });
    });

    this.bindTooltips();
  }

  // ======================== 仓库简视 ========================
  renderQuickWarehouse() {
    const g = this.engine.state;
    const qw = document.getElementById('quick-warehouse')!;
    const body = document.getElementById('qw-body')!;
    const toggle = document.getElementById('qw-toggle')!;
    if (g.quickWarehouseCollapsed) { qw.classList.add('collapsed'); toggle.textContent = '仓库简视 [展开]'; }
    else { qw.classList.remove('collapsed'); toggle.textContent = `仓库简视 [${g.warehouse.length}件] [收起]`; }

    let html = g.warehouse.length === 0 ? '<span style="color:var(--text-dim);font-size:12px;">仓库为空</span>' : '';
    for (let wi = 0; wi < g.warehouse.length; wi++) {
      const item = g.warehouse[wi];
      const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
      if (!def) continue;
      html += `<div class="item-row" id="qw-item-${item.instanceId}"><span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span></div>`;
    }
    body.innerHTML = html;
    makeDropZone(body, 'quick-warehouse', undefined, (p) => {
      const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
      if (p.source === 'shop') return this.engine.buyItem(item);
      if (p.source === 'deploy-top' || p.source === 'deploy-slot') { this.engine.moveToWarehouse(item); return null; }
      return '无法放入';
    });
    for (let wi = 0; wi < g.warehouse.length; wi++) {
      const row = document.getElementById(`qw-item-${g.warehouse[wi].instanceId}`);
      if (row) { row.draggable = true; makeDraggable(row, { instanceId: g.warehouse[wi].instanceId, source: 'warehouse', warehouseIdx: wi }); }
    }
    this.bindTooltips();
  }

  // ======================== 按钮 ========================
  renderLeftButtons(isCombat: boolean) {
    const area = document.getElementById('left-btns')!;
    if (isCombat) {
      area.innerHTML = ``;
      return;
    }

    const rp = this.rightPanel;
    area.innerHTML = `
      <button class="btn ${rp === 'warehouse' ? 'active' : ''}" id="btn-warehouse">仓库</button>
      <button class="btn ${rp === 'shop' ? 'active' : ''}" id="btn-shop">商人</button>
      <button class="btn ${rp === 'itemPool' ? 'active' : ''}" id="btn-itempool">物品池</button>
    `;
    document.getElementById('btn-warehouse')!.onclick = () => this.togglePanel('warehouse');
    document.getElementById('btn-shop')!.onclick = () => this.togglePanel('shop');
    document.getElementById('btn-itempool')!.onclick = () => this.togglePanel('itemPool');
  }

  togglePanel(p: string) { this.rightPanel = this.rightPanel === p ? null : p; this.render(); }

  // ======================== 右侧面板（非战斗） ========================
  renderRightPanels() {
    const area = document.getElementById('event-area')!;
    const sellZone = document.getElementById('sell-zone')!;
    // 出售面板常驻
    sellZone.innerHTML = `<div class="panel"><div class="panel-title">出售（售价 = 原价 50%，不可撤销）</div>
      <div class="drop-zone" id="sell-drop" style="min-height:40px;"><span style="color:var(--text-dim);font-size:12px;">拖拽物品到此处出售</span></div></div>`;
    const sd = document.getElementById('sell-drop')!;
    makeDropZone(sd, 'sell', undefined, (p) => {
      const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
      if (p.source === 'shop') return '不能出售商店物品';
      const price = this.engine.sellItem(item);
      if (price === null) return '出售失败';
      this.showToast(`出售: +${price}金币`); return null;
    });

    if (!this.rightPanel) { this.renderEventPanel(area); return; }
    switch (this.rightPanel) {
      case 'warehouse': this.renderWarehouse(area); break;
      case 'shop': this.renderShopFiltered(area); break;
      case 'itemPool': this.renderItemPool(area); break;
    }
  }

  // ---- 事件 ----
  renderEventPanel(c: HTMLElement) {
    const g = this.engine.state;
    if (g.phase !== 1 || g.currentEvents.length === 0) {
      c.innerHTML = '<div class="panel"><div class="panel-title">事件</div><p style="color:var(--text-dim);">探险阶段可查看事件</p></div>';
      return;
    }
    // 过滤已访问的商人事件
    const activeEvents = g.currentEvents.filter(eid => !g.visitedEventMerchants.includes(eid));
    if (activeEvents.length === 0) {
      c.innerHTML = '<div class="panel"><div class="panel-title">探险事件</div><p style="color:var(--text-dim);">本层事件已全部访问</p></div>';
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

    // 使用 generateShopItems 获取全量匹配项，再按价值范围过滤
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
    area.innerHTML = `<div class="panel"><div class="panel-title">${this.engine.getEventName(eid)}</div><div id="event-items"></div><button class="btn" id="btn-close-ev" style="margin-top:6px;">关闭</button></div>`;
    const itemsDiv = document.getElementById('event-items')!;

    if (items.length === 0) {
      itemsDiv.innerHTML = '<p style="color:var(--text-dim);">当前无可购买的物品</p>';
    }

    items.forEach(item => {
      const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
      if (!def) return;
      const basePrice = 'costValue' in def ? Math.abs(def.costValue) : (def as any).value;
      const price = eid === 'discount_merchant' ? Math.floor(basePrice / 2) : eid === 'lottery' ? 0 : basePrice;
      const row = document.createElement('div'); row.className = 'item-row'; row.draggable = true;
      row.innerHTML = `<span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span><span class="item-stat">${'effect' in def ? def.effect : (getEntityCategory(def as EntityDef)).join(' / ')}</span><span style="margin-left:auto;margin-right:6px;font-size:12px;${eid === 'lottery' ? '免费' : price + '金'}</span><button class="btn btn-small">购买</button>`;
      makeDraggable(row, { instanceId: item.instanceId, source: 'shop' });
      row.querySelector('button')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (eid === 'lottery') { this.engine.addToWarehouse(item); this.showToast(`免费获得: ${def.name}`); }
        else { const err = this.engine.buyItem(item); if (err) this.showToast(err); else this.showToast(`购买: ${def.name}`); }
        this.engine.rightPanel = null; this.engine.state.currentEvents = [];
        this.engine.state.visitedEventMerchants.push(eid);
        this.render();
      });
      itemsDiv.appendChild(row);
    });
    document.getElementById('btn-close-ev')!.onclick = () => {
      this.engine.state.visitedEventMerchants.push(eid);
      this.engine.rightPanel = null;
      this.render();
    };
    this.bindTooltips();
  }

  randomItems(n: number, minV: number, maxV: number, entOnly: boolean, affOnly: boolean): ItemInstance[] {
    const pool = this.engine.state.itemPool;
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

  // ---- 仓库面板 ----
  renderWarehouse(c: HTMLElement) {
    const g = this.engine.state;
    let h = '<div class="panel"><div class="panel-title">仓库</div>';
    if (g.warehouse.length === 0) h += '<p style="color:var(--text-dim);">仓库为空</p>';
    else for (let wi = 0; wi < g.warehouse.length; wi++) {
      const item = g.warehouse[wi]; const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
      if (!def) continue;
      h += `<div class="item-row ${item.type === 'affix' ? 'affix' : (isStarter(def as EntityDef) ? 'starter' : 'gear')}" id="wh-item-${item.instanceId}">`;
      h += `<span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span>`;
      if (item.type !== 'affix') h += `<span class="item-stat">${(getEntityCategory(def as EntityDef)).join(' / ')}</span><span class="item-value">价${(def as EntityDef).value}</span>`;
      else h += `<span class="item-stat">${(def as any).effect}</span><span class="item-value">价${Math.abs((def as any).costValue)}</span>`;
      h += '</div>';
    }
    h += '</div>'; c.innerHTML = h;
    for (let wi = 0; wi < g.warehouse.length; wi++) {
      const row = document.getElementById(`wh-item-${g.warehouse[wi].instanceId}`);
      if (row) { row.draggable = true; makeDraggable(row, { instanceId: g.warehouse[wi].instanceId, source: 'warehouse', warehouseIdx: wi }); }
    }
    this.bindTooltips();
  }

  /** 固定商人：不限数量，仅价值限制，支持筛选 */
  renderShopFiltered(c: HTMLElement) {
    const cap = this.engine.getMerchantValueCap();
    const items = this.engine.generateShopItems(this.shopFilter);

    // 筛选按钮行
    const filters = ['all', 'entity', 'affix'] as const;
    const filterLabels: Record<string, string> = { all: '全部', entity: '实体', affix: '词条' };

    let h = `<div class="panel"><div class="panel-title">固定商人（价值上限: ${cap}）</div>`;
    h += '<div class="filter-row">';
    for (const f of filters) {
      h += `<button class="btn btn-small ${this.shopFilter === f ? 'active' : ''}" id="shop-flt-${f}">${filterLabels[f]}</button>`;
    }
    h += `</div><div id="shop-items">`;

    if (items.length === 0) {
      h += '<p style="color:var(--text-dim);">当前筛选无可用物品</p>';
    } else {
      for (const item of items) {
        const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
        if (!def) continue;
        const price = 'costValue' in def ? Math.abs(def.costValue) : (def as any).value;
        h += `<div class="item-row" id="shop-item-${item.instanceId}"><span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span>
          <span class="item-stat">${'effect' in def ? def.effect : (getEntityCategory(def as EntityDef)).join(' / ')}</span>
          <span style="margin-left:auto;margin-right:6px;">${price}金</span><button class="btn btn-small">购买</button></div>`;
      }
    }
    h += '</div></div>';
    c.innerHTML = h;

    // 筛选按钮事件
    for (const f of filters) {
      const btn = document.getElementById(`shop-flt-${f}`);
      if (btn) btn.onclick = () => { this.shopFilter = f; this.render(); };
    }

    // 拖拽 + 购买事件
    items.forEach(item => {
      const row = document.getElementById(`shop-item-${item.instanceId}`);
      if (!row) return; row.draggable = true;
      makeDraggable(row, { instanceId: item.instanceId, source: 'shop' });
      const btn = row.querySelector('button');
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); const err = this.engine.buyItem(item); if (err) this.showToast(err); else this.showToast('购买成功'); });
    });
    this.bindTooltips();
  }

  // ---- 物品池 ----
  renderItemPool(c: HTMLElement) {
    let h = '<div class="panel"><div class="panel-title">物品池</div><div class="filter-row">';
    h += '<button class="btn btn-small active" id="f-all">全部</button><button class="btn btn-small" id="f-entities">实体</button><button class="btn btn-small" id="f-affixes">词条</button></div><div id="ip-list"></div></div>';
    c.innerHTML = h;
    const show = (f: string) => { const l = document.getElementById('ip-list')!; let h2 = '';
      for (const did of this.engine.state.itemPool) { const ed = getEntityDef(did); const ad = getAffixDef(did); if (f === 'entities' && !ed) continue; if (f === 'affixes' && !ad) continue; const d = ed || ad; if (!d) continue;
        h2 += `<div class="item-row" style="cursor:default;"><span class="item-name" data-defid="${did}" data-type="${ed ? 'entity' : 'affix'}">${d.name}</span><span class="item-stat">${d.id}</span></div>`; }
      l.innerHTML = h2; this.bindTooltips(); };
    document.getElementById('f-all')!.onclick = () => show('all');
    document.getElementById('f-entities')!.onclick = () => show('entities');
    document.getElementById('f-affixes')!.onclick = () => show('affixes');
    show('all');
  }

  /** 更新战斗中动态值（HP/耐力/倒计时），只操作 DOM 文本节点，不 re-render。倒计时使用 wall-clock 插值实现平滑递减 */
  private updateCombatDynamicValues() {
    const pu = this.engine.combatPlayerUnits;
    const eu = this.engine.combatEnemyUnits;

    const updateUnit = (units: CombatUnitRuntime[] | null, prefix: string) => {
      if (!units) return;
      for (const u of units) {
        const hpEl = document.getElementById(`cu-hp-${prefix}-${u.entityId}`);
        if (hpEl) hpEl.textContent = `HP:${Math.round(Math.max(u.currentHp, 0))}/${u.totalHp}`;
        const stamEl = document.getElementById(`cu-stam-${prefix}-${u.entityId}`);
        if (stamEl) stamEl.textContent = `耐力:${Math.floor(u.currentStamina)}/${u.maxStamina}`;
        for (let wi = 0; wi < u.weapons.length; wi++) {
          const w = u.weapons[wi];
          const cdEl = document.getElementById(`cu-cd-${prefix}-${u.entityId}-${wi}`);
          if (!cdEl) continue;
          const key = `${prefix}-${u.entityId}-${wi}`;
          const prev = this.weaponPrevRemaining.get(key);
          // 检测引擎 tick：remainingTime 变化时更新时间戳
          if (prev !== undefined && prev !== w.remainingTime) {
            this.lastTickWallTime = Date.now();
          }
          this.weaponPrevRemaining.set(key, w.remainingTime);
          // wall-clock 插值：从上个引擎 tick 起，经过的真实时间
          const wallElapsed = Date.now() - this.lastTickWallTime;
          const spd = this.engine.combatSpeed === 'max' ? 50 : this.engine.combatSpeed;
          const displayMs = Math.max(w.remainingTime - wallElapsed * spd, 0);
          cdEl.textContent = `倒计时:${(displayMs / 1000).toFixed(1)}s`;
        }
      }
    };

    updateUnit(pu, 'p');
    updateUnit(eu, 'e');
  }

  // ======================== 战斗阶段界面 ========================

  /** 左上半区：玩家战斗状态面板（替代 renderDeploy） */
  renderPlayerCombatPanel() {
    const area = document.getElementById('deploy-area')!;
    const pu = this.engine.combatPlayerUnits;
    if (!pu || pu.length === 0) {
      area.innerHTML = '<div class="panel"><div class="panel-title">出战单位</div><p style="color:var(--text-dim);">准备中...</p></div>';
      return;
    }

    let h = '<div class="panel"><div class="panel-title">出战单位</div>';
    for (const u of pu) {
      const alive = u.currentHp > 0;
      h += '<div class="combat-unit">';
      h += `<div class="item-row starter" style="cursor:default;${alive ? '' : 'opacity:0.4;text-decoration:line-through;'}">`;
      h += `<span>${u.entityName}</span>`;
      h += `<span class="item-stat" id="cu-hp-p-${u.entityId}">HP:${Math.max(u.currentHp, 0)}/${u.totalHp}</span>`;
      h += `<span class="item-stat" id="cu-stam-p-${u.entityId}">耐力:${Math.floor(u.currentStamina)}/${u.maxStamina}</span>`;
      if (u.isOverloaded) h += '<span class="item-stat warn">超重</span>';
      h += '</div>';

      // 武器行（含倒计时）
      for (let wi = 0; wi < u.weapons.length; wi++) {
        const w = u.weapons[wi];
        h += `<div class="item-row gear nested-1" style="cursor:default;">`;
        h += `<span>${w.name}</span>`;
        h += `<span class="item-stat">伤害:${w.damage} 耐耗:${w.staminaCost}</span>`;
        h += `<span class="item-stat" id="cu-cd-p-${u.entityId}-${wi}">倒计时:${(w.remainingTime / 1000).toFixed(1)}s</span>`;
        h += `<span class="item-stat">${w.targetType}${w.priorityTarget ? ' [优先' + w.priorityTarget + ']' : ''}</span>`;
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    area.innerHTML = h;
  }

  /** 右上：敌人战斗状态面板 */
  renderEnemyCombatPanel() {
    const area = document.getElementById('event-area')!;
    const eu = this.engine.combatEnemyUnits;
    if (!eu || eu.length === 0) {
      area.innerHTML = '<div class="panel"><div class="panel-title">敌方单位</div><p style="color:var(--text-dim);">准备战斗...</p></div>';
      return;
    }

    let h = '<div class="panel"><div class="panel-title">敌方单位</div>';
    for (const e of eu) {
      const alive = e.currentHp > 0;
      h += '<div class="combat-unit">';
      h += `<div class="item-row starter" style="cursor:default;${alive ? '' : 'opacity:0.4;text-decoration:line-through;'}">`;
      h += `<span>${e.entityName}</span>`;
      h += `<span class="item-stat" id="cu-hp-e-${e.entityId}">HP:${Math.max(e.currentHp, 0)}/${e.totalHp}</span>`;
      h += `<span class="item-stat" id="cu-stam-e-${e.entityId}">耐力:${Math.floor(e.currentStamina)}/${e.maxStamina}</span>`;
      if (e.isOverloaded) h += '<span class="item-stat warn">超重</span>';
      h += '</div>';

      for (let wi = 0; wi < e.weapons.length; wi++) {
        const w = e.weapons[wi];
        h += `<div class="item-row gear nested-1" style="cursor:default;">`;
        h += `<span>${w.name}</span>`;
        h += `<span class="item-stat">伤害:${w.damage}</span>`;
        h += `<span class="item-stat" id="cu-cd-e-${e.entityId}-${wi}">倒计时:${(w.remainingTime / 1000).toFixed(1)}s</span>`;
        h += `<span class="item-stat">${w.targetType}${w.priorityTarget ? ' [优先' + w.priorityTarget + ']' : ''}</span>`;
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    area.innerHTML = h;
  }

  // 右下：战斗日志
  renderCombatLogPanel() {
    const zone = document.getElementById('sell-zone')!;
    let h = '<div class="panel"><div class="panel-title">战斗日志</div>';
    h += '<div id="combat-log-scroll" style="max-height:calc(30vh - 50px);overflow-y:auto;font-size:12px;">';
    if (this.combatLog.length === 0) {
      h += '<span style="color:var(--text-dim);">等待战斗开始...</span>';
    }
    h += '</div></div>';
    zone.innerHTML = h;
    // 重新填充日志
    const scroll = document.getElementById('combat-log-scroll');
    if (scroll && this.combatLog.length > 0) {
      let logHtml = '';
      for (const evt of this.combatLog) {
        if (evt.effects.includes('击杀')) {
          logHtml += `<div class="combat-event">[${evt.time}ms] <b>${evt.targetName} 被击杀!</b></div>`;
        } else if (!evt.actorName) {
          // 系统事件（如"战斗开始"）— 只显示 targetName
          logHtml += `<div class="combat-event">[${evt.time}ms] ${evt.targetName}</div>`;
        } else {
          const tl = evt.targetingLabel ? ` <span style="color:var(--text-dim)">[${evt.targetingLabel}]</span>` : '';
          logHtml += `<div class="combat-event">[${evt.time}ms] ${evt.actorName}·${evt.weaponName}${tl} → ${evt.targetName} ${evt.damage}伤害 (HP:${evt.targetHpAfter}/${evt.targetMaxHp})</div>`;
          for (const eff of evt.effects) {
            if (eff !== '击杀') {
              logHtml += `<div class="combat-event" style="padding-left:20px">${eff}</div>`;
            }
          }
        }
      }
      scroll.innerHTML = logHtml;
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  // ======================== 战斗预览与开战 ========================

  /** 正式战：先抽池，再共用预览，确认后开打（不再二次抽池） */
  async startCombat() {
    this.showToast('正在匹配对手…');
    try {
      const prep = await this.engine.prepareOfficialBattle();
      this.pendingAutoWin = prep.autoWin;
      this.pendingEnemySlots = prep.enemySlots;

      const playerSnaps = this.engine.calculateCombatSnapshots(prep.playerSlots).snapshots;
      const enemySnaps = prep.enemySlots
        ? this.engine.calculateCombatSnapshots(prep.enemySlots).snapshots
        : [];

      showCombatPreview({
        title: '⚔ 战斗预览',
        subtitle: prep.autoWin
          ? '对战池暂无对手，确认后直接获胜'
          : (prep.opponentName ? `对手：${prep.opponentName}` : '确认双方对阵信息后开始战斗'),
        confirmLabel: prep.autoWin ? '确认获胜' : '开始战斗',
        playerSnaps,
        enemySnaps,
        emptyEnemyHint: prep.autoWin ? '对战池暂无对手，确认后直接获胜' : '暂无上场单位',
        onConfirm: () => { void this._doStartCombat(); },
        onCancel: () => {
          this.pendingEnemySlots = null;
          this.pendingAutoWin = false;
        },
      });
    } catch (e: any) {
      this.showToast('匹配失败：' + (e?.message || e));
      this.pendingEnemySlots = null;
      this.pendingAutoWin = false;
    }
  }

  /** 预览确认后开战 */
  private async _doStartCombat() {
    this.combatLog = [];
    this.combatFinished = false;
    this.combatPaused = false;
    this.engine.combatSpeed = 1;

    const onEvent = (evt: CombatEvent) => {
      this.combatLog.push(evt);
      this.renderCombatLogPanel();
      this.lastTickWallTime = Date.now();
    };
    const onEnd = (win: boolean, gold: number) => {
      if (win) this.showToast(`战斗胜利！+${gold}金币`);
      else this.showToast('战斗失败');
      this.combatFinished = true;
      this.pendingEnemySlots = null;
      this.pendingAutoWin = false;
      this.render();
    };

    // 空池：直接结算，进入战斗结束态（仍 phase=2 以便点继续）
    if (this.pendingAutoWin || !this.pendingEnemySlots) {
      this.engine.state.phase = 2;
      this.engine.settleOfficialAutoWin(onEnd);
      return;
    }

    this.engine.state.phase = 2;
    this.render();

    await new Promise(r => setTimeout(r, 300));

    this.lastTickWallTime = Date.now();
    this.weaponPrevRemaining.clear();
    this.combatUpdateTimer = setInterval(() => {
      this.updateCombatDynamicValues();
    }, 100);

    try {
      await this.engine.runCombatWithSides(
        this.engine.state.deploySlots,
        this.pendingEnemySlots,
        onEvent,
        onEnd,
        () => this.combatPaused,
        undefined,
        () => this.engine.combatSpeed,
      );
    } finally {
      if (this.combatUpdateTimer) {
        clearInterval(this.combatUpdateTimer);
        this.combatUpdateTimer = null;
      }
    }
  }

  // ======================== 存档（单存档） ========================
  showSavePanel() {
    const area = document.getElementById('event-area')!;
    area.innerHTML = `<div class="panel"><div class="panel-title">保存存档</div>
      <p style="margin:8px 0;font-size:13px;">当前进度将覆盖已有存档</p>
      <button class="btn" id="btn-do-save">确认保存</button></div>`;
    document.getElementById('btn-do-save')!.onclick = async () => {
      try { await this.engine.manualSave(); this.showToast('存档成功'); this.rightPanel = null; this.render(); }
      catch (e: any) { this.showToast('存档失败: ' + e.message); }
    };
  }

  // ======================== Tooltip ========================
  bindTooltips() {
    document.querySelectorAll('.item-name[data-defid]').forEach(el => {
      const span = el as HTMLElement;
      const clone = span.cloneNode(true) as HTMLElement;
      span.parentNode!.replaceChild(clone, span);
      clone.addEventListener('mouseenter', (e) => showTooltip(e as MouseEvent, clone.dataset.defid!, clone.dataset.type as any));
      clone.addEventListener('mousemove', (e) => {
        const tip = document.getElementById('tooltip');
        if (tip && tip.style.display !== 'none') { tip.style.left = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 10) + 'px'; tip.style.top = Math.min(e.clientY + 12, window.innerHeight - tip.offsetHeight - 10) + 'px'; }
      });
      clone.addEventListener('mouseleave', hideTooltip);
    });
  }
}
