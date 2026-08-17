// 探险事件定义与选项生成
import { AFFIX_DEFS } from './data';

export const EVENT_CHOICE_COUNT = 3;

export type ExploreEventId =
  | 'hire'
  | 'smuggler'
  | 'craftsman'
  | 'work'
  | 'invest'
  | 'open_path'
  | 'nine_thirteen'
  | 'path_merchant';

export interface ExploreEventDef {
  id: ExploreEventId;
  name: string;
  /** 必定出现的游戏 round（奇数探险） */
  mustAppearOn: number[];
  /**
   * 可随机出现的游戏 round。
   * 空数组 = 全部奇数探险回合（1..maxRound 中的奇数），受 canAppearMinRound 约束。
   */
  canAppearOn: number[];
  /** canAppearOn 为空时，仅 round >= 此值的奇数探险可随机出现 */
  canAppearMinRound?: number;
}

export const EXPLORE_EVENT_DEFS: ExploreEventDef[] = [
  { id: 'hire', name: '雇佣', mustAppearOn: [1], canAppearOn: [] },
  { id: 'smuggler', name: '走私商人', mustAppearOn: [], canAppearOn: [] },
  { id: 'craftsman', name: '工匠', mustAppearOn: [], canAppearOn: [] },
  { id: 'work', name: '打工', mustAppearOn: [], canAppearOn: [] },
  { id: 'invest', name: '投资', mustAppearOn: [], canAppearOn: [1, 3, 5, 7] },
  {
    id: 'open_path',
    name: '开启路线',
    mustAppearOn: [3],
    canAppearOn: [],
    canAppearMinRound: 5,
  },
  { id: 'nine_thirteen', name: '九出十三归', mustAppearOn: [], canAppearOn: [] },
  { id: 'path_merchant', name: '路线商人', mustAppearOn: [], canAppearOn: [5, 7, 9] },
];

export type EventStatus = 'pending' | 'active' | 'done';

export interface CraftsmanReturnRef {
  kind: 'warehouse' | 'deploy';
  /** 仓库顶层下标（移出前） */
  warehouseIndex?: number;
  parentId?: string | null;
  slotIdx?: number;
  childIndex?: number;
  /** 是否为第一层 deploy 实体 */
  wasTopLevel?: boolean;
}

function allExploreRounds(maxRound: number): number[] {
  const out: number[] = [];
  for (let r = 1; r <= maxRound; r += 2) out.push(r);
  return out;
}

/** 路线词条 id 集合（category === 'path'） */
export function getPathAffixIds(): Set<string> {
  return new Set(AFFIX_DEFS.filter(d => d.category === 'path').map(d => d.id));
}

/** 路线解锁物：poolPrerequisite 含任一路线词条 id */
export function isPathGatedDef(def: { poolPrerequisite: string[] }, pathIds?: Set<string>): boolean {
  const paths = pathIds ?? getPathAffixIds();
  return def.poolPrerequisite.some(p => paths.has(p));
}

export function eventCanAppear(def: ExploreEventDef, round: number, maxRound: number): boolean {
  if (def.mustAppearOn.includes(round)) return true;
  const can = def.canAppearOn.length > 0
    ? def.canAppearOn
    : allExploreRounds(maxRound).filter(
        r => def.canAppearMinRound == null || r >= def.canAppearMinRound,
      );
  return can.includes(round);
}

export function pickExploreEvents(
  round: number,
  maxRound: number,
  n: number,
  rand: () => number,
): ExploreEventId[] {
  const guaranteed = EXPLORE_EVENT_DEFS
    .filter(d => d.mustAppearOn.includes(round))
    .map(d => d.id);
  const guaranteedSet = new Set(guaranteed);
  const pool = EXPLORE_EVENT_DEFS
    .filter(d => !guaranteedSet.has(d.id) && eventCanAppear(d, round, maxRound))
    .map(d => d.id);
  const slotsLeft = Math.max(0, n - guaranteed.length);
  const random: ExploreEventId[] = [];
  const poolCopy = [...pool];
  for (let i = 0; i < slotsLeft && poolCopy.length > 0; i++) {
    const idx = Math.floor(rand() * poolCopy.length);
    random.push(poolCopy.splice(idx, 1)[0]);
  }
  return [...guaranteed, ...random];
}

export function getExploreEventName(id: string): string {
  return EXPLORE_EVENT_DEFS.find(d => d.id === id)?.name || id;
}

export function getExploreEventDesc(id: string, cap: number, nextCap: number): string {
  switch (id) {
    case 'hire':
      return `6 个可购启动端，原价，买一次`;
    case 'smuggler':
      return `6 实体+3 词条，价值 ${cap + 1}~${nextCap}，加价 50%`;
    case 'craftsman':
      return `放入 1 个实体，七选一永久强化`;
    case 'work':
      return `立刻获得 10 金（同次仅一次）`;
    case 'invest':
      return `支付 10 金，备用池 +15，可多次投资`;
    case 'open_path':
      return '全部路线词条各 1，原价，可任购';
    case 'nine_thirteen':
      return `立刻 +9 金，备用池 −13，可多次借贷`;
    case 'path_merchant':
      return '路线物品 6 实体+3 词条，原价（可重复）';
    default:
      return '';
  }
}

export type ShopRollKind = 'entity' | 'affix';

export interface ShopRollCandidate {
  defId: string;
  type: ShopRollKind;
  bodyValue: number;
}
