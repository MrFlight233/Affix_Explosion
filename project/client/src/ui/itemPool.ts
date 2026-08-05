// ============================================================
// 全物品池只读页（仿制作物品 #adm-page）
// ============================================================

import {
  ENTITY_DEFS,
  AFFIX_DEFS,
  getEntityDef,
  getAffixDef,
  getEntityCategory,
  getEntityCategoryFilters,
  getCategoryName,
  getAffixFilterCategories,
  getDefPackageTradeValue,
  getAffixPackageTradeValue,
  type EntityDef,
  type AffixDef,
  type DefaultChildSpec,
} from '../game/data';
import {
  formatTargetingSummary,
  SORT_BY_LABELS,
  FILTER_LABELS,
  normalizeFilterBy,
} from '../game/targetingUtil';
import { formatConfigEffectsBlock } from '../game/activeActionDisplay';
import { migrateLegacyDamageToOnHitEffects } from '../game/hitEffectUtil';
import {
  formatPassiveTargetLine,
  hasDisplayPassive,
  passiveEffectPlainLines,
  passiveRootHint,
  resolvePassiveForDisplay,
} from './passiveBonusDisplay';

type TabType = 'entities' | 'affixes';

interface TabSession {
  searchQuery: string;
  selectedId: string | null;
  entityCatFilter: string;
  affixCatFilter: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function disp(v: unknown, empty = '—'): string {
  if (v === null || v === undefined || v === '') return empty;
  return String(v);
}

function getChildDefId(spec: string | DefaultChildSpec): string {
  return typeof spec === 'string' ? spec : spec?.defId || 'unknown';
}

function sumEntitySlotCosts(defIds: string[]): number {
  return defIds.reduce((sum, id) => {
    const e = getEntityDef(id);
    const n = e ? Number(e.slotCost) : 0;
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

function sumAffixSlotCosts(defIds: string[]): number {
  return defIds.reduce((sum, id) => {
    const a = getAffixDef(id);
    const n = a ? Number(a.slotCost) : 0;
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/** 导出：启动页「全物品池」 */
export function showFullItemPool(onBack: () => void): void {
  const app = document.getElementById('app')!;

  let tab: TabType = 'entities';
  const sessions: Record<TabType, TabSession> = {
    entities: {
      searchQuery: '',
      selectedId: null,
      entityCatFilter: 'all',
      affixCatFilter: 'all',
    },
    affixes: {
      searchQuery: '',
      selectedId: null,
      entityCatFilter: 'all',
      affixCatFilter: 'all',
    },
  };

  /** 折叠记忆：`${itemId}:${foldKey}` → true=折叠 */
  const foldState = new Map<string, boolean>();

  function sess(): TabSession {
    return sessions[tab];
  }

  function foldKey(itemId: string, section: string): string {
    return `${itemId}:${section}`;
  }

  function isFolded(itemId: string, section: string): boolean {
    return foldState.get(foldKey(itemId, section)) === true;
  }

  function field(label: string, value: unknown): string {
    return `<div class="ip-field"><label>${esc(label)}</label><div class="val">${esc(disp(value))}</div></div>`;
  }

  function section(title: string, body: string, count?: string): string {
    const countHtml = count
      ? `<span class="count">${esc(count)}</span>`
      : '';
    return `<div class="ip-section"><div class="ip-section-h">${esc(title)}${countHtml}</div>${body}</div>`;
  }

  function affixRefRow(id: string, effectExtra?: string): string {
    const a = getAffixDef(id);
    const name = a?.name || id;
    const cat = a ? getCategoryName(a.category) : '';
    const effect = effectExtra ?? (a?.effect || '—');
    return `<div class="ip-ref-row">
      <span class="ref-name">${esc(name)}</span>
      <span class="ref-cat">${esc(cat)}</span>
      <span class="ref-effect">${esc(effect)}</span>
    </div>`;
  }

  function foldBlock(
    itemId: string,
    sectionKey: string,
    title: string,
    sub: string,
    bodyHtml: string,
  ): string {
    const folded = isFolded(itemId, sectionKey);
    return `
      <div class="ip-fold-h" data-fold="${esc(sectionKey)}" role="button" tabindex="0">
        ${esc(title)}${sub ? ` <span class="sub">${sub}</span>` : ''}
        <span class="fold-label">${folded ? '展开' : '收起'}</span>
      </div>
      <div class="ip-fold-body${folded ? ' folded' : ''}" data-fold-body="${esc(sectionKey)}">
        ${bodyHtml || '<div class="ip-hint">无</div>'}
      </div>`;
  }

  function affixRowsOrEmpty(ids: string[]): string {
    if (!ids.length) return '<div class="ip-hint">无</div>';
    return ids.map(id => affixRefRow(id)).join('');
  }

  function buildEntityDetail(e: EntityDef): string {
    const dynSlots = Number(e.dynamicAffixSlots) || 0;
    const preloaded = e.preloadedDynamicAffixes || [];
    const dynUsed = sumAffixSlotCosts(preloaded);
    const entitySlots = Number(e.entitySlots) || 0;
    const children = e.defaultChildren || [];
    const childIds = children.map(getChildDefId);
    const childUsed = sumEntitySlotCosts(childIds);
    const poolPrereq = e.poolPrerequisite || [];
    const fixed = e.fixedAffixes || [];

    let h = `<h3>查看实体：${esc(e.name)}</h3>`;

    // 基本信息
    h += section('基本信息', [
      field('ID', e.id),
      field('名称', e.name),
      field('占用槽位', e.slotCost),
      field('重量', e.weight),
      field('价值', getDefPackageTradeValue(e)),
      field('本体价值', e.value),
    ].join(''));

    // 词条关联
    {
      let body = '';
      body += foldBlock(
        e.id,
        'fixed',
        '固定词条',
        `（${fixed.length}）`,
        affixRowsOrEmpty(fixed),
      );

      if (poolPrereq.length === 0) {
        body += field('池前置', '—');
      } else {
        body += `<div class="ip-fold-h" style="cursor:default;background:#fcfcfc;">池前置 <span class="sub">（${poolPrereq.length}）</span></div>`;
        body += poolPrereq.map(id => affixRefRow(id)).join('');
      }

      body += field('动态词条槽位', dynSlots);

      if (dynSlots > 0) {
        body += foldBlock(
          e.id,
          'dyn',
          '预装动态词条',
          `已用 ${dynUsed} / ${dynSlots}`,
          preloaded.length
            ? preloaded.map(id => {
                const a = getAffixDef(id);
                const slot = a ? `槽耗 ${a.slotCost}` : '';
                const eff = a?.effect || '';
                const extra = [slot, eff].filter(Boolean).join(' · ') || '—';
                return affixRefRow(id, extra);
              }).join('')
            : '<div class="ip-hint">无</div>',
        );
      }

      h += section('词条关联', body);
    }

    // 默认子实体
    {
      let body = field('实体槽位', entitySlots);
      if (entitySlots > 0) {
        const rows = children.length
          ? children.map(spec => {
              const defId = getChildDefId(spec);
              const cd = getEntityDef(defId);
              const ov = typeof spec === 'object' && spec?.overrides
                ? Object.keys(spec.overrides).length
                : 0;
              const name = (cd?.name || defId) + (ov > 0 ? ' (定制)' : '');
              const cat = cd ? getEntityCategory(cd).join(' / ') : '';
              const effect = cd
                ? `槽耗 ${cd.slotCost} · 价 ${getDefPackageTradeValue(cd)}${ov > 0 ? ` · 覆写${ov}字段` : ''}`
                : '—';
              return `<div class="ip-ref-row">
                <span class="ref-name">${esc(name)}</span>
                <span class="ref-cat">${esc(cat)}</span>
                <span class="ref-effect">${esc(effect)}</span>
              </div>`;
            }).join('')
          : '<div class="ip-hint">无</div>';
        body += foldBlock(
          e.id,
          'child',
          '子实体列表',
          `（${children.length}）`,
          rows,
        );
      } else {
        body += '<div class="ip-hint">无槽位</div>';
      }
      h += section(
        '默认子实体',
        body,
        entitySlots > 0 ? `已用 ${childUsed} / ${entitySlots} 槽位` : undefined,
      );
    }

    // 战斗属性
    h += section('战斗属性', [
      field('HP', e.hp),
      field('耐力上限', e.maxStamina),
      field('耐力恢复/秒', e.staminaRegen),
      field('HP恢复/秒', e.hpRegen),
      field('负重上限', e.maxLoad),
    ].join(''));

    // 主动动作
    {
      let body = field('主动动作', e.isActive ? '有' : '无');
      if (e.isActive) {
        const tc = e.targetCondition;
        const effects = migrateLegacyDamageToOnHitEffects(e.onHitEffects, Number(e.damage) || 0);
        const effectLines = formatConfigEffectsBlock(effects);
        body += [
          field('耐力消耗', e.staminaCost),
          field('触发耗时(ms)', e.actionTime),
          field('主动目标', formatTargetingSummary({
            targetFaction: e.targetFaction,
            sortBy: tc?.sortBy,
            targetOrder: e.targetOrder,
            priorityTarget: e.priorityTarget,
            filterBy: tc?.filterBy,
            targetCount: e.targetCount ?? tc?.targetCount,
          })),
          field('主动效果', effectLines.length ? effectLines.join('<br>') : '无'),
        ].join('');
      }
      h += section('主动动作', body);
    }

    // 被动加成
    {
      const hasPB = hasDisplayPassive(e);
      let body = field('被动加成模式', e.hasPassiveBonuses === true ? '有' : '无');
      if (hasPB) {
        const pcfg = resolvePassiveForDisplay(e);
        body += field('被动目标', formatPassiveTargetLine(pcfg));
        body += field('被动效果', passiveEffectPlainLines(pcfg).join('<br>') || '—');
        const hint = passiveRootHint(pcfg);
        if (hint) body += field('说明', hint);
      }
      h += section('被动加成', body);
    }

    return h;
  }

  function buildAffixDetail(a: AffixDef): string {
    let h = `<h3>查看词条：${esc(a.name)}</h3>`;

    h += section('基本信息', [
      field('ID', a.id),
      field('名称', a.name),
      field('分类', getCategoryName(a.category)),
      field('效果描述', a.effect),
      field('价值', getAffixPackageTradeValue(a)),
      field('槽位消耗', a.slotCost),
      field('可重复', a.repeatable ? '是' : '否'),
    ].join(''));

    // 前置条件
    {
      const prereq = a.prerequisite || [];
      const pool = a.poolPrerequisite || [];
      let body = '';
      if (prereq.length === 0) {
        body += field('前置词条', '—');
      } else {
        body += `<div class="ip-fold-h" style="cursor:default;background:#fcfcfc;">前置词条 <span class="sub">（${prereq.length}）</span></div>`;
        body += prereq.map(id => affixRefRow(id)).join('');
      }
      if (pool.length === 0) {
        body += field('池前置', '—');
      } else {
        body += `<div class="ip-fold-h" style="cursor:default;background:#fcfcfc;">池前置 <span class="sub">（${pool.length}）</span></div>`;
        body += pool.map(id => affixRefRow(id)).join('');
      }
      h += section('前置条件', body);
    }

    // 主动目标覆写
    {
      const tm = a.targetingModifier;
      const tmEnabled = !!(
        tm && (
          tm.targetFaction !== undefined ||
          tm.sortBy !== undefined ||
          tm.filterBy !== undefined ||
          tm.targetCount !== undefined ||
          tm.targetOrder !== undefined ||
          tm.priorityTarget !== undefined
        )
      );
      let body = field('覆写模式', tmEnabled ? '修改' : '不修改');
      if (tmEnabled && tm) {
        const sort =
          tm.sortBy === null ? '无（清除排序）'
            : tm.sortBy === undefined ? '不修改'
              : (SORT_BY_LABELS[tm.sortBy] || tm.sortBy);
        const filters = normalizeFilterBy(tm.filterBy);
        const filter =
          tm.filterBy === null ? '无（清除过滤）'
            : tm.filterBy === undefined ? '不修改'
              : (filters.map(f => FILTER_LABELS[f] || f).join('+') || '—');
        const count =
          tm.targetCount === null ? '无（清除）'
            : tm.targetCount === undefined ? '不修改'
              : tm.targetCount === 'all' ? '全部' : String(tm.targetCount);
        body += [
          field('统一排序', sort),
          field('过滤', filter),
          field('目标数量', count),
          field('摘要', formatTargetingSummary({
            targetFaction: tm.targetFaction,
            sortBy: tm.sortBy,
            targetOrder: tm.targetOrder,
            priorityTarget: tm.priorityTarget,
            filterBy: tm.filterBy,
            targetCount: tm.targetCount,
          })),
        ].join('');
      }
      h += section('主动目标覆写', body);
    }

    // 主动效果
    {
      const effectLines = formatConfigEffectsBlock(a.onHitEffects);
      let body = effectLines.length === 0
        ? field('主动效果', '无')
        : effectLines.map(line => field('主动效果', line)).join('');
      h += section('主动效果', body);
    }

    // 被动加成
    {
      const hasPB = hasDisplayPassive(a);
      let body = field('被动加成模式', a.hasPassiveBonuses === true ? '有' : '无');
      if (hasPB) {
        const pcfg = resolvePassiveForDisplay(a);
        body += field('被动目标', formatPassiveTargetLine(pcfg));
        body += field('被动效果', passiveEffectPlainLines(pcfg).join('<br>') || '—');
        const hint = passiveRootHint(pcfg);
        if (hint) body += field('说明', hint);
      }
      h += section('被动加成', body);
    }

    return h;
  }

  function getFilteredEntities(): EntityDef[] {
    const s = sess();
    let list = ENTITY_DEFS.slice();
    if (s.entityCatFilter !== 'all') {
      list = list.filter(e => getEntityCategory(e).includes(s.entityCatFilter));
    }
    const q = s.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(e =>
        e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
      );
    }
    return list;
  }

  function getFilteredAffixes(): AffixDef[] {
    const s = sess();
    let list = AFFIX_DEFS.slice();
    if (s.affixCatFilter !== 'all') {
      list = list.filter(a => a.category === s.affixCatFilter);
    }
    const q = s.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(a =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.effect || '').toLowerCase().includes(q),
      );
    }
    return list;
  }

  function renderChips(): void {
    const el = document.getElementById('ip-cat-filter');
    if (!el) return;
    const s = sess();
    let html = '';
    if (tab === 'entities') {
      // 与制作物品实体 Tab 一致：仅分类 Chip（全部 + 实体分类名）
      for (const cat of getEntityCategoryFilters()) {
        const label = cat === 'all' ? '全部' : cat;
        html += `<button type="button" class="ip-chip${s.entityCatFilter === cat ? ' active' : ''}" data-ecat="${esc(cat)}">${esc(label)}</button>`;
      }
    } else {
      html += `<button type="button" class="ip-chip${s.affixCatFilter === 'all' ? ' active' : ''}" data-acat="all">全部</button>`;
      for (const c of getAffixFilterCategories()) {
        html += `<button type="button" class="ip-chip${s.affixCatFilter === c.id ? ' active' : ''}" data-acat="${esc(c.id)}">${esc(c.name)}</button>`;
      }
    }
    el.innerHTML = html;
  }

  function renderList(): void {
    const listEl = document.getElementById('ip-list');
    if (!listEl) return;
    const s = sess();
    let html = '';
    if (tab === 'entities') {
      for (const e of getFilteredEntities()) {
        const meta = getEntityCategory(e).join(' / ') || '—';
        html += `<div class="ip-list-item${s.selectedId === e.id ? ' selected' : ''}" data-id="${esc(e.id)}" role="button" tabindex="0">
          <span class="name">${esc(e.name)}</span>
          <span class="meta">${esc(meta)}</span>
          <span class="price">价 ${getDefPackageTradeValue(e)}</span>
        </div>`;
      }
    } else {
      for (const a of getFilteredAffixes()) {
        html += `<div class="ip-list-item${s.selectedId === a.id ? ' selected' : ''}" data-id="${esc(a.id)}" role="button" tabindex="0">
          <span class="name">${esc(a.name)}</span>
          <span class="meta">${esc(getCategoryName(a.category))}</span>
          <span class="price">价 ${getAffixPackageTradeValue(a)}</span>
        </div>`;
      }
    }
    if (!html) {
      html = '<div class="ip-empty-hint">无匹配项</div>';
    }
    listEl.innerHTML = html;
  }

  function renderDetail(): void {
    const right = document.getElementById('ip-right');
    if (!right) return;
    const id = sess().selectedId;
    if (!id) {
      right.innerHTML = '<p class="ip-empty-hint">← 点击左侧物品查看详情</p>';
      return;
    }
    if (tab === 'entities') {
      const e = getEntityDef(id);
      right.innerHTML = e
        ? buildEntityDetail(e)
        : '<p class="ip-empty-hint">实体不存在</p>';
    } else {
      const a = getAffixDef(id);
      right.innerHTML = a
        ? buildAffixDetail(a)
        : '<p class="ip-empty-hint">词条不存在</p>';
    }
    bindFoldEvents();
  }

  function bindFoldEvents(): void {
    const id = sess().selectedId;
    if (!id) return;
    document.querySelectorAll('#ip-right .ip-fold-h[data-fold]').forEach(el => {
      const h = el as HTMLElement;
      if (!h.dataset.fold || h.style.cursor === 'default') return;
      const toggle = () => {
        const key = h.dataset.fold!;
        const body = document.querySelector(`#ip-right [data-fold-body="${key}"]`) as HTMLElement | null;
        if (!body) return;
        const next = !body.classList.contains('folded');
        body.classList.toggle('folded', next);
        foldState.set(foldKey(id, key), next);
        const label = h.querySelector('.fold-label');
        if (label) label.textContent = next ? '展开' : '收起';
      };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
          ev.preventDefault();
          toggle();
        }
      });
    });
  }

  function updateTabs(): void {
    document.querySelectorAll('.ip-tab').forEach(btn => {
      const b = btn as HTMLElement;
      b.classList.toggle('active', b.dataset.tab === tab);
    });
  }

  function renderAll(): void {
    updateTabs();
    renderChips();
    const search = document.getElementById('ip-search') as HTMLInputElement | null;
    if (search && search.value !== sess().searchQuery) search.value = sess().searchQuery;
    renderList();
    renderDetail();
  }

  function switchTab(newTab: TabType): void {
    if (tab === newTab) return;
    tab = newTab;
    const right = document.getElementById('ip-right');
    if (right) {
      right.style.opacity = '0.6';
      setTimeout(() => { right.style.opacity = '1'; }, 120);
    }
    renderAll();
  }

  app.innerHTML = `
    <div id="ip-page">
      <div id="ip-header">
        <button type="button" class="btn" id="ip-btn-back">← 返回</button>
        <h2>全物品池</h2>
        <div id="ip-tabs">
          <button type="button" class="ip-tab active" data-tab="entities">实体</button>
          <button type="button" class="ip-tab" data-tab="affixes">词条</button>
        </div>
      </div>
      <div id="ip-body">
        <div id="ip-left">
          <div id="ip-cat-filter"></div>
          <div id="ip-search-wrap">
            <div class="ip-search-cmd">
              <input type="text" id="ip-search" placeholder="搜索 ID 或名称…" autocomplete="off">
              <kbd class="ip-search-cmd-k">Ctrl+K</kbd>
            </div>
          </div>
          <div id="ip-list"></div>
        </div>
        <div id="ip-right">
          <p class="ip-empty-hint">← 点击左侧物品查看详情</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('ip-btn-back')!.addEventListener('click', onBack);

  document.querySelectorAll('.ip-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = (btn as HTMLElement).dataset.tab as TabType;
      if (t) switchTab(t);
    });
  });

  document.getElementById('ip-cat-filter')!.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.ip-chip') as HTMLElement | null;
    if (!chip) return;
    const s = sess();
    if (chip.dataset.ecat) {
      s.entityCatFilter = chip.dataset.ecat;
      s.selectedId = null;
    } else if (chip.dataset.acat) {
      s.affixCatFilter = chip.dataset.acat;
      s.selectedId = null;
    }
    renderAll();
  });

  const searchInput = document.getElementById('ip-search') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    sess().searchQuery = searchInput.value;
    renderList();
  });

  document.addEventListener('keydown', onKeyDown);
  function onKeyDown(ev: KeyboardEvent) {
    if (!document.getElementById('ip-page')) {
      document.removeEventListener('keydown', onKeyDown);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  }

  document.getElementById('ip-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.ip-list-item') as HTMLElement | null;
    if (!item?.dataset.id) return;
    sess().selectedId = item.dataset.id;
    renderList();
    renderDetail();
  });

  document.getElementById('ip-list')!.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const item = (ev.target as HTMLElement).closest('.ip-list-item') as HTMLElement | null;
    if (!item?.dataset.id) return;
    ev.preventDefault();
    sess().selectedId = item.dataset.id;
    renderList();
    renderDetail();
  });

  renderAll();
}
