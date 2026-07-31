// ============================================================
// 目标选择：归一化 / 展示摘要（实体·词条·战斗共用）
// ============================================================

export const FACTION_FILTERS = new Set(['友方', '敌人', '自己']);

export type TargetCount = number | 'all';

export type TargetSortBy =
  | '从上往下'
  | '从下往上'
  | '站位1' | '站位2' | '站位3' | '站位4' | '站位5'
  | '站位中间'
  | 'hp_asc' | 'hp_desc'
  | 'hp_pct_asc' | 'hp_pct_desc'
  | 'stamina_asc' | 'stamina_desc'
  | 'stamina_pct_asc' | 'stamina_pct_desc'
  | 'random';

export const SORT_BY_LABELS: Record<string, string> = {
  '从上往下': '从上往下',
  '从下往上': '从下往上',
  '站位1': '站位1',
  '站位2': '站位2',
  '站位3': '站位3',
  '站位4': '站位4',
  '站位5': '站位5',
  '站位中间': '站位中间',
  hp_asc: 'HP最低',
  hp_desc: 'HP最高',
  hp_pct_asc: 'HP%最低',
  hp_pct_desc: 'HP%最高',
  stamina_asc: '耐力最低',
  stamina_desc: '耐力最高',
  stamina_pct_asc: '耐力%最低',
  stamina_pct_desc: '耐力%最高',
  random: '随机',
};

export const FILTER_LABELS: Record<string, string> = {
  '友方': '友方',
  '敌人': '敌人',
  '自己': '自己',
  not_self: '排除自己',
  is_starter: '仅启动端',
  is_stake: '仅木桩',
  hp_below_50pct: 'HP低于50%',
  has_debuff: '有负面状态',
  most_buffs: '有增益状态',
};

/** 旧 string / 新数组 → string[] */
export function normalizeFilterBy(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string' && x.length > 0);
  if (typeof raw === 'string') return [raw];
  return [];
}

/** 目标数量：空/非法 → 1；-1 或 'all' → all */
export function normalizeTargetCount(raw: unknown): TargetCount {
  if (raw === 'all' || raw === -1 || raw === '-1') return 'all';
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), 99);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1) return Math.min(n, 99);
  }
  return 1;
}

/**
 * 解析有效排序。priorityTarget 优先映射为站位k；否则 targetOrder / 旧 sortBy；皆空 → random。
 */
export function resolveSortBy(opts: {
  sortBy?: string | null;
  targetOrder?: string | null;
  priorityTarget?: number | null;
}): string {
  if (opts.priorityTarget != null && opts.priorityTarget >= 1 && opts.priorityTarget <= 5) {
    return `站位${opts.priorityTarget}`;
  }
  if (opts.sortBy) return opts.sortBy;
  if (opts.targetOrder === '从上往下' || opts.targetOrder === '从下往上') return opts.targetOrder;
  return 'random';
}

export function splitFilters(filters: string[]): { factions: string[]; attrs: string[] } {
  const factions: string[] = [];
  const attrs: string[] = [];
  for (const f of filters) {
    if (FACTION_FILTERS.has(f)) factions.push(f);
    else attrs.push(f);
  }
  return { factions, attrs };
}

/** 遗留 targetFaction → 阵营过滤标签（所有=友方+敌人） */
export function factionTagsFromLegacy(targetFaction: string | null | undefined): string[] {
  if (!targetFaction) return [];
  if (targetFaction === '自己') return ['自己'];
  if (targetFaction === '友方') return ['友方'];
  if (targetFaction === '所有') return ['友方', '敌人'];
  if (targetFaction === '敌人') return ['敌人'];
  return [];
}

/**
 * 阵营只来自 filterBy 中的阵营标签。
 * 若无阵营标签，可把遗留 targetFaction 并入（读档兼容）；仍无则 [] → 空目标池。
 */
export function resolveFactionTags(
  filters: string[],
  legacyTargetFaction?: string | null,
): string[] {
  const { factions } = splitFilters(filters);
  if (factions.length > 0) return [...new Set(factions)];
  return factionTagsFromLegacy(legacyTargetFaction);
}

/** 合并过滤：无阵营时并入遗留 targetFaction */
export function mergeFiltersWithLegacyFaction(
  filterBy: unknown,
  legacyTargetFaction?: string | null,
): string[] {
  const filters = normalizeFilterBy(filterBy);
  if (splitFilters(filters).factions.length > 0) return filters;
  const migrated = factionTagsFromLegacy(legacyTargetFaction);
  return migrated.length ? [...filters, ...migrated] : filters;
}

export interface TargetingSummaryInput {
  /** @deprecated 仅展示旧档兼容 */
  targetFaction?: string | null;
  sortBy?: string | null;
  targetOrder?: string | null;
  priorityTarget?: number | null;
  filterBy?: unknown;
  targetCount?: unknown;
}

/** 卡片 / 悬停 / 物品池共用摘要 */
export function formatTargetingSummary(input: TargetingSummaryInput): string {
  const filters = mergeFiltersWithLegacyFaction(input.filterBy, input.targetFaction);
  const factions = resolveFactionTags(filters);
  const { attrs } = splitFilters(filters);
  const sort = resolveSortBy({
    sortBy: input.sortBy,
    targetOrder: input.targetOrder,
    priorityTarget: input.priorityTarget,
  });
  const count = normalizeTargetCount(input.targetCount);
  const countLabel = count === 'all' ? '全部' : `×${count}`;
  const parts: string[] = [];
  parts.push(factions.length ? factions.map(f => FILTER_LABELS[f] || f).join('+') : '无阵营');
  parts.push(SORT_BY_LABELS[sort] || sort);
  if (attrs.length) parts.push(attrs.map(a => FILTER_LABELS[a] || a).join('+'));
  parts.push(countLabel);
  return parts.join(' · ');
}

export const ATTR_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '友方', label: '友方' },
  { value: '敌人', label: '敌人' },
  { value: '自己', label: '自己' },
  { value: 'not_self', label: '排除自己' },
  { value: 'is_starter', label: '仅启动端' },
  { value: 'is_stake', label: '仅木桩' },
  { value: 'hp_below_50pct', label: 'HP低于50%' },
  { value: 'has_debuff', label: '有负面状态' },
  { value: 'most_buffs', label: '有增益状态' },
];

export const SORT_BY_OPTIONS: { value: string; label: string }[] = Object.entries(SORT_BY_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/** Admin：排序下拉 options HTML */
export function sortByOptionsHtml(selected: string | null | undefined, includeEmpty = true, emptyLabel = '随机（缺省）'): string {
  let h = includeEmpty ? `<option value=""${!selected ? ' selected' : ''}>${emptyLabel}</option>` : '';
  for (const o of SORT_BY_OPTIONS) {
    h += `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${o.label}</option>`;
  }
  return h;
}

/** Admin：过滤多选 checkbox HTML */
export function filterCheckboxesHtml(name: string, selected: string[]): string {
  const set = new Set(selected);
  return ATTR_FILTER_OPTIONS.map(o =>
    `<label style="margin-right:8px;white-space:nowrap"><input type="checkbox" name="${name}" value="${o.value}"${set.has(o.value) ? ' checked' : ''}> ${o.label}</label>`,
  ).join('');
}

/** 读表单多选过滤 */
export function readFilterCheckboxes(name: string, root: Document | ParentNode = document): string[] {
  return Array.from(root.querySelectorAll(`input[name="${name}"]:checked`))
    .map(el => (el as HTMLInputElement).value)
    .filter(Boolean);
}
