// ============================================================
// 界面渲染 — 含完整战斗阶段界面
// ============================================================

import { GameEngine, CombatEvent, EnemyUnit } from '../game/engine';
import {
  EntityDef, ItemInstance,
  getEntityDef, getAffixDef, isActionable, isEquipment,
} from '../game/data';
import { EquipmentEntity, ActionableEntity } from '../game/data';
import { makeDraggable, makeDropZone, DragPayload } from './dragDrop';
import { showTooltip, hideTooltip } from './tooltip';

export class UIManager {
  engine: GameEngine;
  rightPanel: string | null = null;

  // 战斗状态
  combatEnemies: EnemyUnit[] = [];
  combatLog: CombatEvent[] = [];
  combatSpeed: number = 1;

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
    this.renderDeploy(isCombat);
    if (!isCombat) this.renderQuickWarehouse();
    this.renderLeftButtons(isCombat);

    if (isCombat) {
      this.renderEnemyPanel();
      this.renderCombatLogPanel();
    } else {
      this.renderRightPanels();
    }
  }

  // ======================== HUD ========================
  renderHUD() {
    const hud = document.getElementById('hud')!;
    const g = this.engine.state;
    const canSave = (g.phase === 1 || g.phase === 3) && g.phase !== 2;

    hud.innerHTML = `
      <div class="hud-item"><span class="hud-label">金币</span><span class="hud-value">${g.gold}</span></div>
      <div class="hud-item"><span class="hud-label">层-轮</span><span class="hud-value">${g.floor}-${g.round}</span></div>
      <div class="hud-item"><span class="hud-label">阶段</span><span class="hud-value">${this.engine.getPhaseLabel()}</span></div>
      <div class="hud-item"><span class="hud-label">活力</span><span class="hud-value">${this.engine.getVitalityUsed()}/${g.maxVitality}</span></div>
      <div class="hud-right">
        ${canSave ? '<button id="btn-save">存档</button>' : ''}
        ${g.phase !== 2 ? `<button id="btn-next">${g.phase === 3 ? '下一轮' : (g.phase === 1 && g.deploySlots.length > 0 ? '开始战斗' : '下一阶段')}</button>` : ''}
      </div>
    `;

    if (canSave) document.getElementById('btn-save')!.onclick = () => this.showSavePanel();
    const btnNext = document.getElementById('btn-next');
    if (btnNext) {
      btnNext.onclick = () => {
        if (g.phase === 1 && g.deploySlots.length === 0) { this.showToast('请先配置出场 BD'); return; }
        if (g.phase === 1) { this.startCombat(); }
        else { this.engine.nextPhase(); }
      };
    }
  }

  // ======================== 出场面板 ========================
  renderDeploy(locked: boolean = false) {
    const area = document.getElementById('deploy-area')!;
    const g = this.engine.state;
    let html = `<div class="panel"><div class="panel-title">出场面板${locked ? ' [锁定]' : ''}</div>`;
    html += '<div class="drop-zone" id="deploy-top-drop" style="min-height:40px;">';
    if (g.deploySlots.length === 0) html += '<span style="color:var(--text-dim);font-size:12px;">拖拽可行动实体至此</span>';
    html += '</div>';

    for (let si = 0; si < g.deploySlots.length; si++) {
      const slot = g.deploySlots[si];
      const edef = getEntityDef(slot.entity.defId) as ActionableEntity | undefined;
      if (!edef) continue;
      let load = 0;
      for (const c of slot.children) { const cd = getEntityDef(c.defId); if (cd && cd.kind === 'equipment') load += (cd as EquipmentEntity).weight; }
      const over = load > edef.maxLoad;

      html += `<div class="drop-zone" id="deploy-slot-${si}" style="margin-top:4px;min-height:36px;">`;
      html += `<div class="item-row actionable" id="item-${slot.entity.instanceId}">`;
      html += `<span class="item-name" data-defid="${slot.entity.defId}" data-type="entity">${edef.name}</span>`;
      html += `<span class="item-stat">HP:${edef.hp} 伤害:${edef.baseDamage} 耗时:${edef.baseActionTime}ms</span>`;
      html += `<span class="item-stat">耐力:${edef.maxStamina}/${edef.staminaRegen}/s 负重:${load}/${edef.maxLoad}</span>`;
      if (over) html += `<span class="item-stat warn">超重</span>`;
      html += `<span class="item-stat">${edef.attackType} ${edef.attackOrder}${edef.priorityTarget ? ' [优先' + edef.priorityTarget + ']' : ''}</span>`;
      html += `<span class="item-value">价${edef.value}</span></div>`;

      for (let ci = 0; ci < slot.children.length; ci++) {
        const child = slot.children[ci];
        const cdef = child.type === 'entity' ? getEntityDef(child.defId) : getAffixDef(child.defId);
        if (!cdef) continue;
        const cls = child.type === 'affix' ? 'affix' : 'equipment';
        html += `<div class="item-row ${cls} nested-1" id="item-${child.instanceId}">`;
        html += `<span class="item-name" data-defid="${child.defId}" data-type="${child.type}">${cdef.name}</span>`;
        if (child.type !== 'affix') {
          const c = cdef as EquipmentEntity;
          if (c.isActive) html += `<span class="item-stat">伤害:${c.damageBonus} 耐耗:${c.staminaCost} ${c.attackType}</span>`;
          if (c.armorBonus) html += `<span class="item-stat">护甲:${c.armorBonus}</span>`;
          if (c.hpBonus) html += `<span class="item-stat">HP:${c.hpBonus}</span>`;
          if (c.actionTimeMod) html += `<span class="item-stat">耗时${c.actionTimeMod > 0 ? '+' : ''}${c.actionTimeMod}ms</span>`;
          html += `<span class="item-stat">重:${c.weight}</span><span class="item-value">价${c.value}</span>`;
        } else {
          const a = cdef as any;
          html += `<span class="item-stat">${a.effect}</span><span class="item-value">价${Math.abs(a.costValue)}</span>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    area.innerHTML = html;

    if (!locked) {
      this.bindDeployDragEvents();
    }
    this.bindTooltips();
  }

  bindDeployDragEvents() {
    const g = this.engine.state;
    const top = document.getElementById('deploy-top-drop');
    if (top) makeDropZone(top, 'deploy-top', undefined, (p) => {
      const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
      if (p.source === 'shop') return this.engine.buyAndEquip(item, undefined);
      return this.engine.moveToDeploy(item, undefined);
    });
    for (let si = 0; si < g.deploySlots.length; si++) {
      const el = document.getElementById(`deploy-slot-${si}`);
      if (el) makeDropZone(el, 'deploy-slot', si, (p, _z, tgt) => {
        const item = this.engine.findItem(p.instanceId); if (!item) return '物品不存在';
        if (p.source === 'shop') return this.engine.buyAndEquip(item, tgt);
        return this.engine.moveToDeploy(item, tgt);
      });
      // 实体行拖拽
      const er = document.getElementById(`item-${g.deploySlots[si].entity.instanceId}`);
      if (er) { er.draggable = true; makeDraggable(er, { instanceId: g.deploySlots[si].entity.instanceId, source: 'deploy-top', slotIdx: si }); }
      for (let ci = 0; ci < g.deploySlots[si].children.length; ci++) {
        const cr = document.getElementById(`item-${g.deploySlots[si].children[ci].instanceId}`);
        if (cr) { cr.draggable = true; makeDraggable(cr, { instanceId: g.deploySlots[si].children[ci].instanceId, source: 'deploy-slot', slotIdx: si, childIdx: ci }); }
      }
    }
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
      const sp = this.combatSpeed;
      area.innerHTML = `
        <span style="font-size:12px;color:var(--text-dim);margin-right:4px;">速度:</span>
        <button class="btn btn-small ${sp === 0.5 ? 'active' : ''}" id="btn-speed-05">0.5x</button>
        <button class="btn btn-small ${sp === 1 ? 'active' : ''}" id="btn-speed-1">1x</button>
        <button class="btn btn-small ${sp === 2 ? 'active' : ''}" id="btn-speed-2">2x</button>
      `;
      document.getElementById('btn-speed-05')!.onclick = () => { this.combatSpeed = 0.5; this.render(); };
      document.getElementById('btn-speed-1')!.onclick = () => { this.combatSpeed = 1; this.render(); };
      document.getElementById('btn-speed-2')!.onclick = () => { this.combatSpeed = 2; this.render(); };
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
      case 'shop': this.renderShop(area); break;
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
    let h = '<div class="panel"><div class="panel-title">探险事件（选择 1 个）</div>';
    for (const eid of g.currentEvents)
      h += `<div class="event-card" data-event="${eid}"><h4>${this.engine.getEventName(eid)}</h4><p>${this.eventDesc(eid)}</p></div>`;
    h += '</div>'; c.innerHTML = h;
    c.querySelectorAll('.event-card').forEach(card => card.addEventListener('click', () => this.triggerEvent((card as HTMLElement).dataset.event!)));
  }

  eventDesc(eid: string): string {
    const cap = this.engine.getMerchantValueCap();
    const m: Record<string, string> = { good_merchant: `随机6件,价值${cap}~${cap + 3}`, entity_merchant: `随机6件实体,价值${cap}~${cap + 3}`, affix_merchant: `随机6件词条,价值${cap}~${cap + 3}`, discount_merchant: '随机6件,半价', lottery: '随机6件,免费选1件' };
    return m[eid] || '';
  }

  triggerEvent(eid: string) {
    const cap = this.engine.getMerchantValueCap();
    let items: ItemInstance[] = [];
    if (eid === 'good_merchant') items = this.randomItems(6, cap, cap + 3, false, false);
    else if (eid === 'entity_merchant') items = this.randomItems(6, cap, cap + 3, true, false);
    else if (eid === 'affix_merchant') items = this.randomItems(6, cap, cap + 3, false, true);
    else if (eid === 'discount_merchant') items = this.randomItems(6, 1, cap, false, false);
    else if (eid === 'lottery') items = this.randomItems(6, 1, cap, false, false);

    const area = document.getElementById('event-area')!;
    area.innerHTML = `<div class="panel"><div class="panel-title">${this.engine.getEventName(eid)}</div><div id="event-items"></div><button class="btn" id="btn-close-ev" style="margin-top:6px;">关闭</button></div>`;
    const itemsDiv = document.getElementById('event-items')!;
    items.forEach(item => {
      const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
      if (!def) return;
      const price = eid === 'discount_merchant' ? Math.floor(('costValue' in def ? Math.abs(def.costValue) : (def as any).value) / 2) : eid === 'lottery' ? 0 : ('costValue' in def ? Math.abs(def.costValue) : (def as any).value);
      const row = document.createElement('div'); row.className = 'item-row'; row.draggable = true;
      row.innerHTML = `<span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span><span style="margin-left:auto;margin-right:6px;font-size:12px;">${eid === 'lottery' ? '免费' : price + '金'}</span><button class="btn btn-small">购买</button>`;
      makeDraggable(row, { instanceId: item.instanceId, source: 'shop' });
      row.querySelector('button')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (eid === 'lottery') { this.engine.addToWarehouse(item); this.showToast(`免费获得: ${def.name}`); }
        else { const err = this.engine.buyItem(item); if (err) this.showToast(err); else this.showToast(`购买: ${def.name}`); }
        this.engine.rightPanel = null; this.engine.state.currentEvents = []; this.render();
      });
      itemsDiv.appendChild(row);
    });
    document.getElementById('btn-close-ev')!.onclick = () => { this.engine.rightPanel = null; this.render(); };
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
      h += `<div class="item-row ${item.type === 'affix' ? 'affix' : (((def as any).kind === 'actionable') ? 'actionable' : 'equipment')}" id="wh-item-${item.instanceId}">`;
      h += `<span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span>`;
      if (item.type !== 'affix') h += `<span class="item-stat">${(def as any).category || ''}</span><span class="item-value">价${(def as EntityDef).value}</span>`;
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

  // ---- 商店 ----
  renderShop(c: HTMLElement) {
    const cap = this.engine.getMerchantValueCap();
    const items = this.randomItems(8, 1, cap, false, false);
    let h = `<div class="panel"><div class="panel-title">固定商人（价值上限: ${cap}）</div>`;
    items.forEach(item => {
      const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId); if (!def) return;
      const price = 'costValue' in def ? Math.abs(def.costValue) : (def as any).value;
      h += `<div class="item-row" id="shop-item-${item.instanceId}"><span class="item-name" data-defid="${item.defId}" data-type="${item.type}">${def.name}</span>
        <span class="item-stat">${'effect' in def ? def.effect : (def as any).category || ''}</span>
        <span style="margin-left:auto;margin-right:6px;">${price}金</span><button class="btn btn-small">购买</button></div>`;
    });
    h += '</div>'; c.innerHTML = h;
    items.forEach(item => {
      const row = document.getElementById(`shop-item-${item.instanceId}`);
      if (!row) return; row.draggable = true;
      makeDraggable(row, { instanceId: item.instanceId, source: 'shop' });
      row.querySelector('button')!.addEventListener('click', (e) => { e.stopPropagation(); const err = this.engine.buyItem(item); if (err) this.showToast(err); else this.showToast('购买成功'); });
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

  // ======================== 战斗阶段界面 ========================

  // 右上：敌人面板
  renderEnemyPanel() {
    const area = document.getElementById('event-area')!;
    let h = '<div class="panel"><div class="panel-title">敌人 BD</div>';
    for (const e of this.combatEnemies) {
      const alive = e.hp > 0;
      h += `<div class="item-row actionable" style="cursor:default;${alive ? '' : 'opacity:0.4;text-decoration:line-through;'}">`;
      h += `<span>${e.name}</span>`;
      h += `<span class="item-stat">HP:${Math.max(e.hp, 0)}/${e.maxHp}</span>`;
      h += `<span class="item-stat">伤害:${e.damage}</span>`;
      h += `<span class="item-stat">护甲:${e.armor}</span>`;
      h += `<span class="item-stat">${e.attackType} ${e.attackOrder}${e.priorityTarget ? ' [优先' + e.priorityTarget + ']' : ''}</span>`;
      h += `</div>`;
      for (const ch of e.children) {
        h += `<div class="item-row equipment nested-1" style="cursor:default;">`;
        h += `<span>${ch.name}</span><span class="item-stat">${ch.desc}</span>`;
        h += `</div>`;
      }
    }
    if (this.combatEnemies.length === 0) h += '<p style="color:var(--text-dim);">准备战斗...</p>';
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
        } else {
          logHtml += `<div class="combat-event">[${evt.time}ms] ${evt.actorName} ${evt.weaponName} ${evt.targetName} → ${evt.damage}伤害 (HP:${evt.targetHpAfter}/${evt.targetMaxHp})</div>`;
        }
      }
      scroll.innerHTML = logHtml;
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  // 开始战斗
  async startCombat() {
    this.combatLog = [];
    this.combatSpeed = 1;
    this.engine.state.phase = 2;
    this.render();

    const enemies = this.engine.generateEnemyBD();
    this.combatEnemies = enemies;
    this.render();

    // 延迟一下让 UI 先渲染
    await new Promise(r => setTimeout(r, 300));

    await this.engine.runCombat(
      (evt) => {
        this.combatLog.push(evt);
        // 更新敌人 HP
        for (const e of this.combatEnemies) {
          if (e.name === evt.targetName) { e.hp = evt.targetHpAfter; break; }
        }
        this.renderCombatLogPanel();
      },
      (win, gold) => {
        if (win) {
          this.showToast(`战斗胜利！+${gold}金币`);
          this.engine.state.phase = 3;
          this.combatEnemies = [];
          this.combatLog = [];
          this.render();
        } else {
          this.showToast('战斗失败');
          // 保持战斗界面，让玩家看到结果
          setTimeout(() => {
            this.combatEnemies = [];
            this.combatLog = [];
            this.render();
          }, 2000);
        }
      },
      this.combatSpeed,
    );
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
