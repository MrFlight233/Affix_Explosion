import type { ItemInstance, DeploySlot } from '../../game/data';

export type CardSide = 'player' | 'enemy' | 'warehouse';
export type CardMode = 'build' | 'battle';

export interface CollapseState {
  collapsedCards: Set<string>;
  collapsedAffixBlocks: Set<string>;
  collapsedChildBlocks: Set<string>;
  /** 集合内 = 已展开；缺省折叠 */
  expandedFixedAffixRows: Set<string>;
  collapsedDynAffixRows: Set<string>;
  /** 集合内 = 已展开；缺省折叠 */
  expandedCombatModBlocks: Set<string>;
}

/** 折叠 / UI 绑定用侧向作用域键；BD 数据 instanceId 不变 */
export function collapseKey(side: CardSide, instanceId: string): string {
  return `${side}:${instanceId}`;
}

export function parseCollapseKey(key: string): { side: CardSide; instanceId: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const side = key.slice(0, idx);
  if (side !== 'player' && side !== 'enemy' && side !== 'warehouse') return null;
  const instanceId = key.slice(idx + 1);
  if (!instanceId) return null;
  return { side, instanceId };
}

/** 若为作用域键则取裸 instanceId，否则原样返回（兼容旧 DOM） */
export function instanceIdFromCollapseKey(key: string): string {
  return parseCollapseKey(key)?.instanceId ?? key;
}

export function createCollapseState(): CollapseState {
  return {
    collapsedCards: new Set(),
    collapsedAffixBlocks: new Set(),
    collapsedChildBlocks: new Set(),
    expandedFixedAffixRows: new Set(),
    collapsedDynAffixRows: new Set(),
    expandedCombatModBlocks: new Set(),
  };
}

/** 将物品子树内所有卡片标记为折叠（键含 side） */
export function collapseItemTree(item: ItemInstance, collapse: CollapseState, side: CardSide): void {
  collapse.collapsedCards.add(collapseKey(side, item.instanceId));
  for (const c of item.children || []) collapseItemTree(c, collapse, side);
}

/** 正式局 BD + 仓库全树默认折叠（继续游戏 / 进探险壳） */
export function collapseAllOfficialBuild(
  deploySlots: DeploySlot[],
  warehouse: ItemInstance[],
  collapse: CollapseState,
): void {
  for (const s of deploySlots) collapseItemTree(s.entity, collapse, 'player');
  for (const w of warehouse) collapseItemTree(w, collapse, 'warehouse');
}
