// ============================================================
// 正式局探险壳 — BD / 仓库 / 商人，对齐模拟战卡片与 pointer 拖拽
// ============================================================

import { GameEngine, CombatUnitRuntime } from '../game/engine';
import {
  ItemInstance, EntityDef, AffixDef,
  getEntityDef, getAffixDef, findInTree,
  getItemTradeValue,
} from '../game/data';
import { renderEntityCard } from './build/entityCard';
import { bindSbTooltips } from './build/simTooltip';
import { CollapseState, collapseItemTree } from './build/types';
import {
  beginPointerDrag, consumeSuppressNextClick, isPointerDragging,
  PointerDragSession, PointerDragHit,
} from './pointerDrag';

export interface OfficialExploreCtx {
  engine: GameEngine;
  collapse: CollapseState;
  /** 商人/事件目录 Map instanceId -> ItemInstance */
  catalogItems: Map<string, ItemInstance>;
  catalogPrices: Map<string, number>;
  showToast: (msg: string) => void;
  onExploreChanged: () => void;
  resolveCatalogItem: (id: string) => ItemInstance | undefined;
  afterCatalogPurchase: (instanceId: string) => void;
  getCatalogPrice: (id: string) => number | undefined;
}

/** 将 slot.children 并入 entity.children，与模拟战约定一致 */
function normalizeDeploySlots(engine: GameEngine): void {
  for (const slot of engine.state.deploySlots) {
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

export function renderOfficialBdHtml(ctx: OfficialExploreCtx): string {
  normalizeDeploySlots(ctx.engine);
  const g = ctx.engine.state;
  let used = 0;
  for (const s of g.deploySlots) {
    const d = getEntityDef(s.entity.defId);
    if (d) used += d.slotCost;
  }
  const max = ctx.engine.getFirstLayerSlots();

  let h = '<div id="fg-player-bd">';
  h += '<div class="fg-zone-head">出场 BD · 第一层 ' + used + ' / ' + max + '</div>';
  h += '<div class="sb-deploy-area" data-sort-list="top" data-accept="entity" data-side="player">';
  if (g.deploySlots.length === 0) {
    h += '<div class="fg-drop-empty">拖入实体</div>';
  }
  const preview = ctx.engine.previewBdRuntimes(g.deploySlots);
  for (const slot of g.deploySlots) {
    const edef = getEntityDef(slot.entity.defId);
    if (!edef) continue;
    const unit = preview.find(u => u.instanceId === slot.entity.instanceId) || null;
    h += renderEntityCard(slot.entity, 0, 'player', 'build', ctx.collapse, unit, [slot.entity, ...slot.children]);
  }
  h += '</div></div>';
  return h;
}

export function renderOfficialWarehouseHtml(ctx: OfficialExploreCtx): string {
  const wh = ctx.engine.state.warehouse;
  let h = '<div id="fg-warehouse-area">';
  h += '<div class="fg-zone-head">仓库</div>';
  h += '<div class="sb-deploy-area" data-sort-list="top" data-accept="entity,affix" data-side="warehouse" data-fg-zone="unload">';
  if (wh.length === 0) {
    h += '<div class="fg-drop-empty">拖入实体或词条</div>';
  } else {
    for (const item of wh) {
      h += renderEntityCard(item, 0, 'warehouse', 'build', ctx.collapse);
    }
  }
  h += '</div></div>';
  return h;
}

function priceLabelFor(ctx: OfficialExploreCtx, item: ItemInstance, _def: EntityDef | AffixDef): string {
  const override = ctx.catalogPrices.get(item.instanceId);
  if (override !== undefined) {
    return override === 0 ? '免费' : `${override}金`;
  }
  return `${getItemTradeValue(item)}金`;
}

/** 商人货架列表（无筛选；按实例列出，支持同 def 多件） */
export function renderOfficialShopItemListHtml(ctx: OfficialExploreCtx): string {
  const items = [...ctx.catalogItems.values()];
  const entities = items.filter(i => i.type === 'entity');
  const affixes = items.filter(i => i.type === 'affix');

  let h = '<div id="fg-shop-item-list" class="sb-item-list">';

  h += `<div class="sb-pool-sec-header">实体 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${entities.length}</span></div>`;
  if (entities.length === 0) {
    h += '<div class="sb-pool-empty">暂无实体</div>';
  } else {
    for (const item of entities) {
      const e = getEntityDef(item.defId);
      if (!e) continue;
      const price = priceLabelFor(ctx, item, e);
      h += `<div class="sb-pool-item" data-defid="${e.id}" data-type="entity" data-source="shop" data-instance="${item.instanceId}">
        <span class="item-name">${e.name}</span>
        <span class="item-stat">${price}  槽耗${e.slotCost}</span>
      </div>`;
    }
  }

  h += `<div class="sb-pool-sec-header">词条 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${affixes.length}</span></div>`;
  if (affixes.length === 0) {
    h += '<div class="sb-pool-empty">暂无词条</div>';
  } else {
    for (const item of affixes) {
      const a = getAffixDef(item.defId);
      if (!a) continue;
      const price = priceLabelFor(ctx, item, a);
      h += `<div class="sb-pool-item" data-defid="${a.id}" data-type="affix" data-source="shop" data-instance="${item.instanceId}">
        <span class="item-name">${a.name}</span>
        <span class="item-stat">${price}  槽耗${a.slotCost}</span>
      </div>`;
    }
  }

  h += '</div>';
  return h;
}

export function renderOfficialShopHtml(ctx: OfficialExploreCtx): string {
  const cap = ctx.engine.getMerchantValueCap();
  let h = `<div class="panel fg-merchant" id="merchant-panel" data-fg-zone="sell">`;
  h += `<div class="panel-title">商店货架（价值上限: ${cap}）</div>`;
  h += '<p class="fg-sell-hint">拖到左侧出场 BD：购买并装备 · 拖到下方仓库：购买并入库 · 拖入本面板：半价出售</p>';
  const refreshCost = ctx.engine.getShopRefreshCost();
  h += `<button type="button" class="btn" id="btn-shop-refresh" style="margin-bottom:8px;">刷新（${refreshCost}金）· 已刷${ctx.engine.state.shopRefreshCount}次</button>`;
  h += renderOfficialShopItemListHtml(ctx);
  h += '</div>';
  return h;
}

/** 事件奖励行 HTML（sb-pool-item + shop 源） */
export function renderOfficialEventItemRow(item: ItemInstance, priceLabel: string): string {
  const def = item.type === 'entity' ? getEntityDef(item.defId) : getAffixDef(item.defId);
  if (!def) return '';
  const slot = 'slotCost' in def ? def.slotCost : 0;
  return `<div class="sb-pool-item" data-defid="${item.defId}" data-type="${item.type}" data-source="shop" data-instance="${item.instanceId}">
    <span class="item-name">${def.name}</span>
    <span class="item-stat">${priceLabel}  槽耗${slot}</span>
  </div>`;
}

function findSlotIdxForParent(engine: GameEngine, parentId: string): number | undefined {
  const slots = engine.state.deploySlots;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].entity.instanceId === parentId) return i;
    if (findInTree(slots[i].entity, parentId)) return i;
    for (const c of slots[i].children || []) {
      if (c.instanceId === parentId || findInTree(c, parentId)) return i;
    }
  }
  return undefined;
}

function getParentChildren(engine: GameEngine, parentId: string): ItemInstance[] | null {
  for (const slot of engine.state.deploySlots) {
    if (slot.entity.instanceId === parentId) {
      if (!slot.entity.children) slot.entity.children = [];
      return slot.entity.children;
    }
    const found = findInTree(slot.entity, parentId);
    if (found) {
      if (!found.children) found.children = [];
      return found.children;
    }
  }
  return null;
}

function adjustInsertIndex(fromIdx: number, toIdx: number): number {
  if (fromIdx < 0) return toIdx;
  return fromIdx < toIdx ? toIdx - 1 : toIdx;
}

function reorderSameType(
  children: ItemInstance[],
  instanceId: string,
  kind: 'entity' | 'affix',
  toIdx: number,
): string | null {
  const siblings = children.filter(c => c.type === kind);
  const fromIdx = siblings.findIndex(c => c.instanceId === instanceId);
  if (fromIdx < 0) return '找不到同级物品';
  const item = siblings[fromIdx];
  const fullFrom = children.findIndex(c => c.instanceId === instanceId);
  children.splice(fullFrom, 1);
  const adj = adjustInsertIndex(fromIdx, toIdx);
  let insertAt = children.length;
  let seen = 0;
  for (let i = 0; i < children.length; i++) {
    if (children[i].type !== kind) continue;
    if (seen === adj) { insertAt = i; break; }
    seen++;
  }
  children.splice(insertAt, 0, item);
  return null;
}

function resolveOwnedItem(ctx: OfficialExploreCtx, session: PointerDragSession): ItemInstance | undefined {
  if (session.source === 'shop') return ctx.resolveCatalogItem(session.id);
  return ctx.engine.findItem(session.id) ?? ctx.resolveCatalogItem(session.id);
}

function commitOfficialDrag(ctx: OfficialExploreCtx, session: PointerDragSession, hit: PointerDragHit): string | null {
  if (hit.action === 'invalid') return null;

  // ── 工匠槽 ──
  if (hit.parentInstanceId === '__craftsman__' && hit.action === 'mount') {
    if (session.source === 'craftsman') return null;
    const item = ctx.engine.findItem(session.id);
    if (!item || item.type !== 'entity') return '只能放入实体';
    const err = ctx.engine.moveEntityToCraftsman(item);
    if (!err) collapseItemTree(item, ctx.collapse, 'warehouse');
    return err;
  }

  // ── 出售 ──
  if (hit.action === 'sell') {
    if (session.source !== 'bd' && session.source !== 'warehouse') return null;
    const item = ctx.engine.findItem(session.id);
    if (!item) return '物品不存在';
    const price = ctx.engine.sellItem(item);
    if (typeof price === 'string') return price;
    if (price === null) return '出售失败';
    ctx.showToast(`已出售 · +${price} 金币`);
    return null;
  }

  // ── BD / 工匠 → 仓库卸下 ──
  if (hit.action === 'remove') {
    if (session.source === 'craftsman') {
      const item = ctx.engine.extractCraftsmanItem();
      if (!item || item.instanceId !== session.id) return '工匠槽无此实体';
      collapseItemTree(item, ctx.collapse, 'warehouse');
      ctx.engine.addToWarehouse(item);
      return null;
    }
    if (session.source !== 'bd') return null;
    const item = ctx.engine.findItem(session.id);
    if (!item) return '物品不存在';
    collapseItemTree(item, ctx.collapse, 'warehouse');
    return ctx.engine.moveToWarehouse(item);
  }

  if (!hit.side) return '无效目标';

  // ── 同列表重排 ──
  if (hit.action === 'reorder') {
    const toIdx = hit.insertIndex ?? 0;

    if (hit.side === 'warehouse' && hit.listKind === 'top') {
      const wh = ctx.engine.state.warehouse;
      const fromIdx = wh.findIndex(i => i.instanceId === session.id);
      if (fromIdx < 0) return '找不到物品';
      const adj = adjustInsertIndex(fromIdx, toIdx);
      ctx.engine.moveWarehouseItem(fromIdx, Math.max(0, Math.min(adj, wh.length - 1)));
      return null;
    }

    if (hit.side === 'player' && hit.listKind === 'top') {
      const slots = ctx.engine.state.deploySlots;
      const fromIdx = slots.findIndex(s => s.entity.instanceId === session.id);
      if (fromIdx < 0) return '找不到第一层实体';
      const adj = adjustInsertIndex(fromIdx, toIdx);
      ctx.engine.moveDeploySlot(fromIdx, Math.max(0, Math.min(adj, slots.length - 1)));
      return null;
    }

    if (hit.side === 'player' && (hit.listKind === 'child' || hit.listKind === 'affix')) {
      const parentId = hit.parentInstanceId;
      if (!parentId) return '缺少父实体';
      const children = getParentChildren(ctx.engine, parentId);
      if (!children) return '父实体不存在';
      const under = children.some(c => c.instanceId === session.id);
      if (under) {
        const err = reorderSameType(children, session.id, session.kind, toIdx);
        if (err) return err;
        ctx.engine.notify();
        return null;
      }
      // 不在该父下 → fallthrough 到 mount
    } else if (hit.action === 'reorder') {
      return null;
    }
  }

  // ── 挂载 ──
  if (hit.action === 'mount' || hit.action === 'reorder') {
    const parentId = hit.listKind === 'top' ? null : (hit.parentInstanceId ?? null);

    if (hit.side === 'warehouse') {
      if (hit.listKind !== 'top') return '仓库仅支持顶层';
      if (session.source === 'shop') {
        const item = ctx.resolveCatalogItem(session.id);
        if (!item) return '物品不存在';
        const override = ctx.getCatalogPrice(session.id);
        collapseItemTree(item, ctx.collapse, 'warehouse');
        const inShop = ctx.engine.state.shopOffers.some(i => i.instanceId === item.instanceId);
        const inEvent = ctx.engine.state.eventOffers.some(i => i.instanceId === item.instanceId);
        let err: string | null;
        if (inShop) err = ctx.engine.buyFromShopOffer(item, override);
        else if (inEvent) err = ctx.engine.buyFromEventOffer(item);
        else err = ctx.engine.buyItem(item, override);
        if (!err) {
          ctx.afterCatalogPurchase(session.id);
          ctx.showToast('已购买并入库');
        }
        return err;
      }
      if (session.source === 'bd') {
        const item = ctx.engine.findItem(session.id);
        if (!item) return '物品不存在';
        collapseItemTree(item, ctx.collapse, 'warehouse');
        return ctx.engine.moveToWarehouse(item);
      }
      if (session.source === 'craftsman') {
        const held = ctx.engine.state.craftsmanSlot;
        if (!held || held.instanceId !== session.id) return '工匠槽无此实体';
        const item = ctx.engine.extractCraftsmanItem()!;
        collapseItemTree(item, ctx.collapse, 'warehouse');
        ctx.engine.addToWarehouse(item);
        return null;
      }
      if (session.source === 'warehouse') {
        // 顶层已在仓库，视为重排
        return null;
      }
      return '无法放入仓库';
    }

    if (hit.side !== 'player') return '无效目标';

    // 词条必须有父
    if (session.kind === 'affix' && parentId == null) return '词条需要放入实体';

    let slotIdx: number | undefined;
    if (parentId != null) {
      slotIdx = findSlotIdxForParent(ctx.engine, parentId);
      if (slotIdx === undefined) return '父实体不存在';
    }

    if (session.source === 'shop') {
      const item = ctx.resolveCatalogItem(session.id);
      if (!item) return '物品不存在';
      const override = ctx.getCatalogPrice(session.id);
      collapseItemTree(item, ctx.collapse, 'player');
      const inShop = ctx.engine.state.shopOffers.some(i => i.instanceId === item.instanceId);
      const inEvent = ctx.engine.state.eventOffers.some(i => i.instanceId === item.instanceId);
      let err: string | null;
      if (inShop) err = ctx.engine.buyAndEquipFromShop(item, slotIdx, parentId, override);
      else if (inEvent) err = ctx.engine.buyAndEquipFromEvent(item, slotIdx, parentId);
      else err = ctx.engine.buyAndEquip(item, slotIdx, parentId, override);
      if (!err) {
        ctx.afterCatalogPurchase(session.id);
        ctx.showToast('已购买并装备');
      }
      return err;
    }

    if (session.source === 'warehouse' || session.source === 'bd') {
      const item = resolveOwnedItem(ctx, session);
      if (!item) return '物品不存在';
      collapseItemTree(item, ctx.collapse, 'player');
      // 已在目标父下且同列表 → 上面 reorder 已处理；此处为跨位置
      return ctx.engine.moveToDeploy(item, slotIdx, parentId);
    }

    if (session.source === 'craftsman') {
      if (session.kind !== 'entity') return '只能拖出实体';
      const held = ctx.engine.state.craftsmanSlot;
      if (!held || held.instanceId !== session.id) return '工匠槽无此实体';
      const item = ctx.engine.extractCraftsmanItem()!;
      collapseItemTree(item, ctx.collapse, 'player');
      const err = ctx.engine.moveToDeploy(item, slotIdx, parentId);
      if (err) {
        // 放置失败：塞回工匠槽，避免实体丢失
        ctx.engine.state.craftsmanSlot = item;
        ctx.engine.notify();
        return err;
      }
      return null;
    }

    // pool 来源正式局不用
    return '无法放置';
  }

  return null;
}

function bindShopItemPointer(root: HTMLElement, ctx: OfficialExploreCtx): void {
  root.querySelectorAll('.sb-pool-item[data-source="shop"]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const defId = htmlEl.dataset.defid!;
    const type = htmlEl.dataset.type as 'entity' | 'affix';
    const instanceId = htmlEl.dataset.instance!;
    const name = htmlEl.querySelector('.item-name')?.textContent || defId;
    htmlEl.addEventListener('pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      beginPointerDrag(pe, {
        kind: type,
        source: 'shop',
        id: instanceId,
        defId,
        label: name,
        originEl: htmlEl,
      }, { onCommit: (s, h) => commitOfficialDrag(ctx, s, h) });
    });
  });
}

function bindBdPointer(bdEl: HTMLElement, source: 'bd' | 'warehouse', ctx: OfficialExploreCtx): void {
  bdEl.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    const handle = (pe.target as HTMLElement).closest('[data-drag-handle]') as HTMLElement | null;
    if (!handle || !bdEl.contains(handle)) return;
    if ((pe.target as HTMLElement).closest('.sb-card-collapse-btn')) return;
    const instanceId = handle.dataset.instance!;
    const kind = (handle.dataset.kind || 'entity') as 'entity' | 'affix';
    const defId = handle.dataset.defid || '';
    const side = (handle.dataset.side || (source === 'bd' ? 'player' : 'warehouse')) as 'player' | 'warehouse';
    const label = handle.querySelector('.sb-card-header-name')?.textContent
      || handle.textContent?.trim().slice(0, 24)
      || instanceId;
    beginPointerDrag(pe, {
      kind,
      source,
      id: instanceId,
      defId,
      side,
      label,
      originEl: handle,
    }, { onCommit: (s, h) => commitOfficialDrag(ctx, s, h) });
  });
}

function bindCollapseToggles(root: HTMLElement, ctx: OfficialExploreCtx): void {
  // 卡片整体折叠：就地切 CSS（与战斗壳/模拟战一致），避免全量 render 导致监听器叠绑或状态被二次翻转
  root.querySelectorAll('[data-cardtoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.cardtoggle!;
    htmlEl.addEventListener('click', (e) => {
      if (consumeSuppressNextClick() || isPointerDragging()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      const card = htmlEl.closest('.sb-card') as HTMLElement | null;
      if (!card) return;
      const collapsing = !ctx.collapse.collapsedCards.has(instanceId);
      if (collapsing) ctx.collapse.collapsedCards.add(instanceId);
      else ctx.collapse.collapsedCards.delete(instanceId);
      card.classList.toggle('sb-card-collapsed', collapsing);
      const btn = htmlEl.querySelector('.sb-card-collapse-btn');
      if (btn) btn.textContent = collapsing ? '展开' : '收起';
    });
  });

  root.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.affixblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !ctx.collapse.collapsedAffixBlocks.has(instanceId);
      if (collapsing) ctx.collapse.collapsedAffixBlocks.add(instanceId);
      else ctx.collapse.collapsedAffixBlocks.delete(instanceId);
      foldable.classList.toggle('sb-folded', collapsing);
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });

  root.querySelectorAll('[data-childblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.childblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement | null;
      const preview = htmlEl.parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement | null;
      if (!foldable) return;
      const collapsing = !ctx.collapse.collapsedChildBlocks.has(instanceId);
      if (collapsing) ctx.collapse.collapsedChildBlocks.add(instanceId);
      else ctx.collapse.collapsedChildBlocks.delete(instanceId);
      foldable.classList.toggle('sb-folded', collapsing);
      if (preview) preview.style.display = collapsing ? '' : 'none';
      const label = htmlEl.querySelector('span');
      if (label) label.textContent = collapsing ? '展开' : '收起';
    });
  });

  // 固定词条/动态词条行等会改 DOM 结构，需全量重绘
  root.querySelectorAll('[data-fixtoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.fixtoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.collapse.expandedFixedAffixRows.has(instanceId)) ctx.collapse.expandedFixedAffixRows.delete(instanceId);
      else ctx.collapse.expandedFixedAffixRows.add(instanceId);
      ctx.onExploreChanged();
    });
  });

  root.querySelectorAll('[data-combatmodtoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.combatmodtoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.collapse.expandedCombatModBlocks.has(instanceId)) ctx.collapse.expandedCombatModBlocks.delete(instanceId);
      else ctx.collapse.expandedCombatModBlocks.add(instanceId);
      ctx.onExploreChanged();
    });
  });

  root.querySelectorAll('[data-dyntoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.dyntoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.collapse.collapsedDynAffixRows.has(instanceId)) ctx.collapse.collapsedDynAffixRows.delete(instanceId);
      else ctx.collapse.collapsedDynAffixRows.add(instanceId);
      ctx.onExploreChanged();
    });
  });
}

function bindCraftsmanPointer(slotEl: HTMLElement, ctx: OfficialExploreCtx): void {
  const rootId = ctx.engine.state.craftsmanSlot?.instanceId;
  if (!rootId) return;
  slotEl.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    const handle = (pe.target as HTMLElement).closest('[data-drag-handle]') as HTMLElement | null;
    if (!handle || !slotEl.contains(handle)) return;
    if ((pe.target as HTMLElement).closest('.sb-card-collapse-btn')) return;
    // 仅允许拖出工匠槽根实体（不可拖子树内物品单独出槽）
    if (handle.dataset.instance !== rootId) return;
    const defId = handle.dataset.defid || '';
    const label = handle.querySelector('.sb-card-header-name')?.textContent
      || handle.textContent?.trim().slice(0, 24)
      || rootId;
    beginPointerDrag(pe, {
      kind: 'entity',
      source: 'craftsman',
      id: rootId,
      defId,
      side: 'warehouse',
      label,
      originEl: handle,
    }, { onCommit: (s, h) => commitOfficialDrag(ctx, s, h) });
  });
}

export function bindOfficialExplore(root: HTMLElement, ctx: OfficialExploreCtx): void {
  const previewSlotsForTooltip = (): CombatUnitRuntime[] => {
    const slots = [...ctx.engine.state.deploySlots];
    const craft = ctx.engine.state.craftsmanSlot;
    if (craft) slots.push({ entity: craft, children: [] });
    return ctx.engine.previewBdRuntimes(slots);
  };

  bindSbTooltips(root, (id, side) => {
    if (side === 'warehouse') {
      const craft = ctx.engine.state.craftsmanSlot;
      if (craft) {
        const walk = (n: ItemInstance): ItemInstance | null => {
          if (n.instanceId === id) return n;
          for (const c of n.children || []) {
            const f = walk(c);
            if (f) return f;
          }
          return null;
        };
        const inCraft = walk(craft);
        if (inCraft) return inCraft;
      }
      for (const w of ctx.engine.state.warehouse) {
        if (w.instanceId === id) return w;
        const walk = (n: ItemInstance): ItemInstance | null => {
          if (n.instanceId === id) return n;
          for (const c of n.children || []) {
            const f = walk(c);
            if (f) return f;
          }
          return null;
        };
        const found = walk(w);
        if (found) return found;
      }
      return null;
    }
    if (side === 'player') {
      return ctx.engine.findItem(id) ?? null;
    }
    return ctx.engine.findItem(id) ?? ctx.catalogItems.get(id) ?? null;
  }, (id, side) => {
    if (side === 'enemy') return null;
    return previewSlotsForTooltip().find(u => u.instanceId === id) || null;
  }, (id, side) => {
    const craft = ctx.engine.state.craftsmanSlot;
    if (side !== 'player' && craft) {
      const walk = (n: ItemInstance): boolean => {
        if (n.instanceId === id) return true;
        return (n.children || []).some(walk);
      };
      if (walk(craft)) return [craft];
    }
    if (side === 'warehouse') return null;
    const slot = ctx.engine.state.deploySlots.find(s => {
      const walk = (n: ItemInstance): boolean => {
        if (n.instanceId === id) return true;
        return (n.children || []).some(walk);
      };
      return walk(s.entity) || s.children.some(walk);
    });
    return slot ? [slot.entity, ...slot.children] : null;
  });

  const shopPanel = root.querySelector('#merchant-panel') as HTMLElement | null;
  if (shopPanel) {
    const refreshBtn = document.getElementById('btn-shop-refresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        const err = ctx.engine.refreshShop();
        if (err) ctx.showToast(err);
        else {
          ctx.showToast('货架已刷新');
          ctx.onExploreChanged();
        }
      };
    }
  }

  bindShopItemPointer(root, ctx);

  const playerBd = document.getElementById('fg-player-bd');
  if (playerBd) bindBdPointer(playerBd, 'bd', ctx);

  const whArea = document.getElementById('fg-warehouse-area');
  if (whArea) bindBdPointer(whArea, 'warehouse', ctx);

  const craftsmanSlot = document.getElementById('craftsman-slot');
  if (craftsmanSlot) bindCraftsmanPointer(craftsmanSlot, ctx);

  bindCollapseToggles(root, ctx);
}
