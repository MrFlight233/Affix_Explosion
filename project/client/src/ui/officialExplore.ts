// ============================================================
// 正式局探险壳 — BD / 仓库 / 商人，对齐模拟战卡片与 pointer 拖拽
// ============================================================

import { GameEngine } from '../game/engine';
import {
  ItemInstance, EntityDef, AffixDef,
  getEntityDef, getAffixDef, findInTree, getShopAffixFilterCategories, getEntityCategory,
  getItemTradeValue,
} from '../game/data';
import { renderEntityCard } from './build/entityCard';
import {
  PoolFilterState, filterPoolItems, renderPoolFiltersHtml, bindPoolFilterEvents,
} from './build/poolList';
import { bindSbTooltips } from './build/simTooltip';
import { CollapseState, collapseItemTree } from './build/types';
import {
  beginPointerDrag, consumeSuppressNextClick, isPointerDragging,
  PointerDragSession, PointerDragHit,
} from './pointerDrag';

export interface OfficialExploreCtx {
  engine: GameEngine;
  collapse: CollapseState;
  poolFilter: PoolFilterState;
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

function catalogDefs(ctx: OfficialExploreCtx): { entities: EntityDef[]; affixes: AffixDef[]; byDefId: Map<string, ItemInstance> } {
  const entities: EntityDef[] = [];
  const affixes: AffixDef[] = [];
  const byDefId = new Map<string, ItemInstance>();
  for (const item of ctx.catalogItems.values()) {
    byDefId.set(item.defId, item);
    if (item.type === 'entity') {
      const d = getEntityDef(item.defId);
      if (d) entities.push(d);
    } else {
      const d = getAffixDef(item.defId);
      if (d) affixes.push(d);
    }
  }
  return { entities, affixes, byDefId };
}

function priceLabelFor(ctx: OfficialExploreCtx, item: ItemInstance, _def: EntityDef | AffixDef): string {
  const override = ctx.catalogPrices.get(item.instanceId);
  if (override !== undefined) {
    return override === 0 ? '免费' : `${override}金`;
  }
  return `${getItemTradeValue(item)}金`;
}

/** 商人/事件列表（不含筛选条） */
export function renderOfficialShopItemListHtml(ctx: OfficialExploreCtx): string {
  const { entities: allE, affixes: allA, byDefId } = catalogDefs(ctx);
  const { entities, affixes } = filterPoolItems(ctx.poolFilter, { entities: allE, affixes: allA });
  const cs = ctx.poolFilter.collapsedPoolSections;

  let h = '<div id="fg-shop-item-list" class="sb-item-list">';

  const entitySecCollapsed = cs.has('section:entity');
  h += `<div class="sb-pool-sec-header" data-toggle-section="section:entity">${entitySecCollapsed ? '▸' : '▾'} 实体 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${entities.length}</span></div>`;
  if (!entitySecCollapsed) {
    if (entities.length === 0) {
      h += '<div class="sb-pool-empty">无匹配实体</div>';
    } else {
      for (const e of entities) {
        const item = byDefId.get(e.id);
        if (!item) continue;
        const price = priceLabelFor(ctx, item, e);
        h += `<div class="sb-pool-item" data-defid="${e.id}" data-type="entity" data-source="shop" data-instance="${item.instanceId}">
          <span class="item-name">${e.name}</span>
          <span class="item-stat">${price}  槽耗${e.slotCost}</span>
        </div>`;
      }
    }
  }

  const affixSecCollapsed = cs.has('section:affix');
  h += `<div class="sb-pool-sec-header" data-toggle-section="section:affix">${affixSecCollapsed ? '▸' : '▾'} 词条 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${affixes.length}</span></div>`;
  if (!affixSecCollapsed) {
    if (affixes.length === 0) {
      h += '<div class="sb-pool-empty">无匹配词条</div>';
    } else {
      for (const a of affixes) {
        const item = byDefId.get(a.id);
        if (!item) continue;
        const price = priceLabelFor(ctx, item, a);
        h += `<div class="sb-pool-item" data-defid="${a.id}" data-type="affix" data-source="shop" data-instance="${item.instanceId}">
          <span class="item-name">${a.name}</span>
          <span class="item-stat">${price}  槽耗${a.slotCost}</span>
        </div>`;
      }
    }
  }

  h += '</div>';
  return h;
}

export function renderOfficialShopHtml(ctx: OfficialExploreCtx): string {
  const cap = ctx.engine.getMerchantValueCap();
  const { entities: catalogEntities, affixes: catalogAffixes } = catalogDefs(ctx);

  // 可见实体分类名（货架有货）；「all」始终有效
  const presentEntityCats = new Set<string>();
  for (const e of catalogEntities) {
    for (const name of getEntityCategory(e)) presentEntityCats.add(name);
  }
  if (
    ctx.poolFilter.entityCatFilter !== 'all' &&
    !presentEntityCats.has(ctx.poolFilter.entityCatFilter)
  ) {
    ctx.poolFilter.entityCatFilter = 'all';
  }

  // 可见词条分类：showInFilter ∩ 货架有货；不可见则回退「全部」
  const shopCats = getShopAffixFilterCategories().filter(c =>
    catalogAffixes.some(a => a.category === c.id),
  );
  if (
    ctx.poolFilter.affixCatFilter !== 'all' &&
    !shopCats.some(c => c.id === ctx.poolFilter.affixCatFilter)
  ) {
    ctx.poolFilter.affixCatFilter = 'all';
  }

  let h = `<div class="panel fg-merchant" id="merchant-panel" data-fg-zone="sell">`;
  h += `<div class="panel-title">固定商人（价值上限: ${cap}）</div>`;
  h += '<p class="fg-sell-hint">拖到左侧出场 BD：购买并装备 · 拖到下方仓库：购买并入库 · 拖入本面板：半价出售</p>';
  h += renderPoolFiltersHtml(ctx.poolFilter, {
    forShop: true,
    catalogEntities,
    catalogAffixes,
  });
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

  // ── BD → 仓库卸下 ──
  if (hit.action === 'remove') {
    if (session.source !== 'bd') return null;
    const item = ctx.engine.findItem(session.id);
    if (!item) return '物品不存在';
    collapseItemTree(item, ctx.collapse);
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
        collapseItemTree(item, ctx.collapse);
        const err = ctx.engine.buyItem(item, override);
        if (!err) {
          ctx.afterCatalogPurchase(session.id);
          ctx.showToast('已购买并入库');
        }
        return err;
      }
      if (session.source === 'bd') {
        const item = ctx.engine.findItem(session.id);
        if (!item) return '物品不存在';
        collapseItemTree(item, ctx.collapse);
        return ctx.engine.moveToWarehouse(item);
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
      collapseItemTree(item, ctx.collapse);
      const err = ctx.engine.buyAndEquip(item, slotIdx, parentId, override);
      if (!err) {
        ctx.afterCatalogPurchase(session.id);
        ctx.showToast('已购买并装备');
      }
      return err;
    }

    if (session.source === 'warehouse' || session.source === 'bd') {
      const item = resolveOwnedItem(ctx, session);
      if (!item) return '物品不存在';
      collapseItemTree(item, ctx.collapse);
      // 已在目标父下且同列表 → 上面 reorder 已处理；此处为跨位置
      return ctx.engine.moveToDeploy(item, slotIdx, parentId);
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
      if (ctx.collapse.collapsedCards.has(instanceId)) ctx.collapse.collapsedCards.delete(instanceId);
      else ctx.collapse.collapsedCards.add(instanceId);
      ctx.onExploreChanged();
    });
  });

  root.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.affixblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.collapse.collapsedAffixBlocks.has(instanceId)) ctx.collapse.collapsedAffixBlocks.delete(instanceId);
      else ctx.collapse.collapsedAffixBlocks.add(instanceId);
      ctx.onExploreChanged();
    });
  });

  root.querySelectorAll('[data-childblocktoggle]').forEach(el => {
    const htmlEl = el as HTMLElement;
    const instanceId = htmlEl.dataset.childblocktoggle!;
    htmlEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.collapse.collapsedChildBlocks.has(instanceId)) ctx.collapse.collapsedChildBlocks.delete(instanceId);
      else ctx.collapse.collapsedChildBlocks.add(instanceId);
      ctx.onExploreChanged();
    });
  });

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

export function bindOfficialExplore(root: HTMLElement, ctx: OfficialExploreCtx): void {
  bindSbTooltips(root, id => ctx.engine.findItem(id) ?? ctx.catalogItems.get(id) ?? null, (id) => {
    const preview = ctx.engine.previewBdRuntimes(ctx.engine.state.deploySlots);
    return preview.find(u => u.instanceId === id) || null;
  }, (id) => {
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
    bindPoolFilterEvents(shopPanel, ctx.poolFilter, (reason) => {
      if (reason === 'search') {
        const list = document.getElementById('fg-shop-item-list');
        if (list) {
          const tmp = document.createElement('div');
          tmp.innerHTML = renderOfficialShopItemListHtml(ctx);
          const neu = tmp.firstElementChild as HTMLElement;
          list.replaceWith(neu);
          bindShopItemPointer(neu, ctx);
        }
      } else {
        ctx.onExploreChanged();
      }
    });
  }

  bindShopItemPointer(root, ctx);

  const playerBd = document.getElementById('fg-player-bd');
  if (playerBd) bindBdPointer(playerBd, 'bd', ctx);

  const whArea = document.getElementById('fg-warehouse-area');
  if (whArea) bindBdPointer(whArea, 'warehouse', ctx);

  bindCollapseToggles(root, ctx);
}
