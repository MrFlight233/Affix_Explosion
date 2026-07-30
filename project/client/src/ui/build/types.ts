import type { ItemInstance, DeploySlot } from '../../game/data';

export type CardSide = 'player' | 'enemy' | 'warehouse';
export type CardMode = 'build' | 'battle';

export interface CollapseState {
  collapsedCards: Set<string>;
  collapsedAffixBlocks: Set<string>;
  collapsedChildBlocks: Set<string>;
  collapsedFixedAffixRows: Set<string>;
  collapsedDynAffixRows: Set<string>;
}

export function createCollapseState(): CollapseState {
  return {
    collapsedCards: new Set(),
    collapsedAffixBlocks: new Set(),
    collapsedChildBlocks: new Set(),
    collapsedFixedAffixRows: new Set(),
    collapsedDynAffixRows: new Set(),
  };
}

/** 将物品子树内所有卡片标记为折叠 */
export function collapseItemTree(item: ItemInstance, collapse: CollapseState): void {
  collapse.collapsedCards.add(item.instanceId);
  for (const c of item.children || []) collapseItemTree(c, collapse);
}

/** 正式局 BD + 仓库全树默认折叠（继续游戏 / 进探险壳） */
export function collapseAllOfficialBuild(
  deploySlots: DeploySlot[],
  warehouse: ItemInstance[],
  collapse: CollapseState,
): void {
  for (const s of deploySlots) collapseItemTree(s.entity, collapse);
  for (const w of warehouse) collapseItemTree(w, collapse);
}
