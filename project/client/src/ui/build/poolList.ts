import {
  ENTITY_DEFS, AFFIX_DEFS, EntityDef, AffixDef,
  getEntityCategory, getEntityCategoryFilters, getCategoryName,
  getAffixFilterCategories, getShopAffixFilterCategories,
  getDefPackageTradeValue, getAffixPackageTradeValue,
} from '../../game/data';

export interface PoolFilterState {
  poolSearch: string;
  entityCatFilter: string;
  affixCatFilter: string;
  collapsedPoolSections: Set<string>;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function filterPoolItems(
  state: PoolFilterState,
  opts?: { entities?: EntityDef[]; affixes?: AffixDef[] },
): { entities: EntityDef[]; affixes: AffixDef[] } {
  const q = state.poolSearch.toLowerCase();
  let entities = (opts?.entities ?? ENTITY_DEFS).slice();
  let affixes = (opts?.affixes ?? AFFIX_DEFS).slice();

  if (q) {
    entities = entities.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
    affixes = affixes.filter(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.effect.toLowerCase().includes(q));
  }

  if (state.entityCatFilter !== 'all') {
    entities = entities.filter(e => getEntityCategory(e).includes(state.entityCatFilter));
  }
  if (state.affixCatFilter !== 'all') {
    affixes = affixes.filter(a => a.category === state.affixCatFilter);
  }

  return { entities, affixes };
}

export function renderPoolFiltersHtml(
  state: PoolFilterState,
  opts?: {
    forShop?: boolean;
    /** 正式局货架实体：有货才显示对应实体分类 Chip */
    catalogEntities?: EntityDef[];
    /** 正式局货架词条：有货才显示对应词条分类 Chip */
    catalogAffixes?: AffixDef[];
  },
): string {
  let ecats = getEntityCategoryFilters();
  let aCatObjs = opts?.forShop ? getShopAffixFilterCategories() : getAffixFilterCategories();

  // 商店：仅保留货架上实际出现的类型（「全部」始终保留）
  if (opts?.forShop && opts.catalogEntities) {
    const present = new Set<string>();
    for (const e of opts.catalogEntities) {
      for (const name of getEntityCategory(e)) present.add(name);
    }
    ecats = ecats.filter(c => c === 'all' || present.has(c));
  }
  if (opts?.forShop && opts.catalogAffixes) {
    const presentIds = new Set(opts.catalogAffixes.map(a => a.category));
    aCatObjs = aCatObjs.filter(c => presentIds.has(c.id));
  }

  let h = '<div id="sb-pool-filters">';
  h += '<div class="filter-row">';
  for (const c of ecats) {
    h += `<button class="sb-filter-btn${state.entityCatFilter === c ? ' active' : ''}" data-ecat="${c}">${c === 'all' ? '全部实体' : c}</button>`;
  }
  h += '</div>';
  h += '<div class="filter-row">';
  h += `<button class="sb-filter-btn${state.affixCatFilter === 'all' ? ' active' : ''}" data-acat="all">全部词条</button>`;
  for (const c of aCatObjs) {
    h += `<button class="sb-filter-btn${state.affixCatFilter === c.id ? ' active' : ''}" data-acat="${c.id}">${c.name}</button>`;
  }
  h += '</div>';
  h += `<input id="sb-pool-search" type="text" placeholder="搜索名称/ID/效果..." value="${escHtml(state.poolSearch)}">`;
  h += '</div>';
  return h;
}

export function renderPoolEntityRow(e: EntityDef, opts?: { priceLabel?: string }): string {
  const price = opts?.priceLabel ?? `价${getDefPackageTradeValue(e)}`;
  return `<div class="sb-pool-item" data-defid="${e.id}" data-type="entity" data-source="pool">
      <span class="item-name">${e.name}</span>
      <span class="item-stat">${price}  槽耗${e.slotCost}</span>
    </div>`;
}

export function renderPoolAffixRow(a: AffixDef, opts?: { priceLabel?: string }): string {
  const price = opts?.priceLabel ?? `价${getAffixPackageTradeValue(a)}`;
  return `<div class="sb-pool-item" data-defid="${a.id}" data-type="affix" data-source="pool">
      <span class="item-name">${a.name}</span>
      <span class="item-stat">${price}  槽耗${a.slotCost}</span>
    </div>`;
}

export function renderPoolItemListHtml(
  state: PoolFilterState,
  opts?: { entities?: EntityDef[]; affixes?: AffixDef[] },
): string {
  const { entities, affixes } = filterPoolItems(state, opts);
  const cs = state.collapsedPoolSections;

  let h = '<div id="sb-item-list">';

  const entitySecCollapsed = cs.has('section:entity');
  h += `<div class="sb-pool-sec-header" data-toggle-section="section:entity">${entitySecCollapsed ? '▸' : '▾'} 实体 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${entities.length}</span></div>`;
  if (!entitySecCollapsed) {
    if (entities.length === 0) {
      h += '<div class="sb-pool-empty">无匹配实体</div>';
    } else {
      const grouped = new Map<string, EntityDef[]>();
      for (const e of entities) {
        const cat = getEntityCategory(e)[0] || '未知';
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(e);
      }
      for (const [cat, items] of grouped) {
        const catKey = `cat:entity:${cat}`;
        const catCollapsed = cs.has(catKey);
        h += `<div class="sb-pool-cat-header" data-toggle-section="${catKey}">${catCollapsed ? '▸' : '▾'} ${cat} <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${items.length}</span></div>`;
        if (!catCollapsed) {
          for (const e of items) {
            h += renderPoolEntityRow(e);
          }
        }
      }
    }
  }

  const affixSecCollapsed = cs.has('section:affix');
  h += `<div class="sb-pool-sec-header" data-toggle-section="section:affix">${affixSecCollapsed ? '▸' : '▾'} 词条 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${affixes.length}</span></div>`;
  if (!affixSecCollapsed) {
    if (affixes.length === 0) {
      h += '<div class="sb-pool-empty">无匹配词条</div>';
    } else {
      const affixGrouped = new Map<string, AffixDef[]>();
      for (const a of affixes) {
        const catName = getCategoryName(a.category);
        if (!affixGrouped.has(catName)) affixGrouped.set(catName, []);
        affixGrouped.get(catName)!.push(a);
      }
      for (const [catName, items] of affixGrouped) {
        const catKey = `cat:affix:${catName}`;
        const catCollapsed = cs.has(catKey);
        h += `<div class="sb-pool-cat-header" data-toggle-section="${catKey}">${catCollapsed ? '▸' : '▾'} ${catName} <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${items.length}</span></div>`;
        if (!catCollapsed) {
          for (const a of items) {
            h += renderPoolAffixRow(a);
          }
        }
      }
    }
  }

  h += '</div>';
  return h;
}

let poolSearchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 绑定筛选/搜索/折叠；变更后调用 onChange。
 * reason='search' 时仅搜索变了（便于只重绘列表区保留输入焦点）。
 */
export function bindPoolFilterEvents(
  root: HTMLElement,
  state: PoolFilterState,
  onChange: (reason: 'filter' | 'section' | 'search') => void,
): void {
  root.querySelectorAll('[data-ecat]').forEach(el => {
    el.addEventListener('click', () => {
      state.entityCatFilter = (el as HTMLElement).dataset.ecat!;
      onChange('filter');
    });
  });
  root.querySelectorAll('[data-acat]').forEach(el => {
    el.addEventListener('click', () => {
      state.affixCatFilter = (el as HTMLElement).dataset.acat!;
      onChange('filter');
    });
  });
  root.querySelectorAll('[data-toggle-section]').forEach(el => {
    el.addEventListener('click', () => {
      const key = (el as HTMLElement).dataset['toggleSection']!;
      if (state.collapsedPoolSections.has(key)) {
        state.collapsedPoolSections.delete(key);
      } else {
        state.collapsedPoolSections.add(key);
      }
      onChange('section');
    });
  });

  const searchInput = root.querySelector('#sb-pool-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (poolSearchTimer) clearTimeout(poolSearchTimer);
      poolSearchTimer = setTimeout(() => {
        state.poolSearch = searchInput.value;
        onChange('search');
      }, 150);
    });
  }
}
