// 命中效果：规范化、迁移、展示（即时 / 持续数值管道）

import { resolveEffectIdentityRaw } from './effectIdentityUtil';

export type OnHitApplyTo = 'starter' | 'actionOwner' | 'target';
export type OnHitKind = 'instant' | 'duration';
export type OnHitOp = 'gain' | 'loss' | 'set';

/** 即时白名单：当前池 + 本轮 CD */
export type OnHitInstantStat = 'hp' | 'stamina' | 'remainingTime';
/** 持续底盘白名单 */
export type OnHitChassisStat =
  | 'maxHp'
  | 'maxStamina'
  | 'maxLoad'
  | 'hpRegen'
  | 'staminaRegen'
  | 'actionTime'
  | 'staminaCost'
  | 'burden';

export type OnHitStat = OnHitInstantStat | OnHitChassisStat;

export interface OnHitEffect {
  displayName: string;
  /** 缺省即时；读档无 kind 时由 normalize 补齐 */
  kind?: OnHitKind;
  /** duration 必填，毫秒 */
  durationMs?: number;
  /** 有则 Tick 壳，无则底盘修饰（互斥） */
  tickIntervalMs?: number;
  /** duration 必填；可用展示名默认填充 */
  buffKey?: string;
  stat: OnHitStat;
  op: OnHitOp;
  params: { amount?: number; percent?: number };
  applyTo?: OnHitApplyTo[];
}

const APPLY_TO_SET = new Set<OnHitApplyTo>(['starter', 'actionOwner', 'target']);
const OP_SET = new Set<OnHitOp>(['gain', 'loss', 'set']);

export const INSTANT_STATS = new Set<OnHitStat>(['hp', 'stamina', 'remainingTime']);
export const CHASSIS_STATS = new Set<OnHitStat>([
  'maxHp', 'maxStamina', 'maxLoad', 'hpRegen', 'staminaRegen',
  'actionTime', 'staminaCost', 'burden',
]);
export const ALL_STATS = new Set<OnHitStat>([...INSTANT_STATS, ...CHASSIS_STATS]);
export const WEAPON_STATS = new Set<OnHitStat>(['actionTime', 'staminaCost', 'remainingTime']);

const STAT_SET = ALL_STATS;

export function isInstantStat(stat: OnHitStat): boolean {
  return INSTANT_STATS.has(stat);
}

export function isChassisStat(stat: OnHitStat): boolean {
  return CHASSIS_STATS.has(stat);
}

export function isWeaponStat(stat: OnHitStat): boolean {
  return WEAPON_STATS.has(stat);
}

export function effectKind(effect: OnHitEffect): OnHitKind {
  if (effect.kind === 'duration') return 'duration';
  if (effect.kind === undefined && (effect.durationMs ?? 0) > 0) return 'duration';
  return 'instant';
}

export function isTickShell(effect: OnHitEffect): boolean {
  return effectKind(effect) === 'duration' && (effect.tickIntervalMs ?? 0) > 0;
}

export function defaultDisplayName(stat: OnHitStat, op: OnHitOp): string {
  const table: Partial<Record<OnHitStat, Partial<Record<OnHitOp, string>>>> = {
    hp: { loss: '伤害', gain: '回复', set: 'HP变为' },
    stamina: { loss: '削耐', gain: '增耐', set: '耐力变为' },
    remainingTime: { loss: '缩短倒计时', gain: '延长倒计时', set: '倒计时变为' },
    maxHp: { loss: '削血上限', gain: '加血上限' },
    maxStamina: { loss: '削耐上限', gain: '加耐上限' },
    maxLoad: { loss: '削负重上限', gain: '加负重上限' },
    hpRegen: { loss: '削生命恢复', gain: '加生命恢复' },
    staminaRegen: { loss: '削耐力恢复', gain: '加耐力恢复' },
    actionTime: { loss: '缩短耗时', gain: '加长耗时' },
    staminaCost: { loss: '减耐耗', gain: '加耐耗' },
    burden: { loss: '减轻重压', gain: '加重压' },
  };
  return table[stat]?.[op] || '效果';
}

export function resolveApplyTo(effect: OnHitEffect): OnHitApplyTo[] {
  const raw = effect.applyTo;
  if (!raw || raw.length === 0) return ['target'];
  const out = raw.filter((r): r is OnHitApplyTo => APPLY_TO_SET.has(r as OnHitApplyTo));
  return out.length > 0 ? out : ['target'];
}

/** 百分比相对 cap 向下取整后与固定值相加 */
export function computeHitEffectValue(
  cap: number,
  params: { amount?: number; percent?: number } | undefined,
): number {
  const amount = params?.amount ?? 0;
  const percent = params?.percent ?? 0;
  const percentPart = Math.floor(cap * percent / 100);
  return percentPart + amount;
}

function migrateLegacyTypeEffect(raw: Record<string, any>): OnHitEffect | null {
  const type = String(raw.type || '');
  const params = (raw.params && typeof raw.params === 'object') ? { ...raw.params } : {};
  const amount = Number(params.amount) || 0;
  const percent = Number(params.percent) || 0;
  const p: { amount?: number; percent?: number } = {};
  if (params.amount !== undefined) p.amount = amount;
  if (params.percent !== undefined) p.percent = percent;

  const map: Record<string, { stat: OnHitStat; op: OnHitOp; applyTo: OnHitApplyTo[]; name: string }> = {
    damage: { stat: 'hp', op: 'loss', applyTo: ['target'], name: '伤害' },
    heal: { stat: 'hp', op: 'gain', applyTo: ['target'], name: '回复' },
    stamina_drain: { stat: 'stamina', op: 'loss', applyTo: ['target'], name: '削耐' },
    stamina_gain: { stat: 'stamina', op: 'gain', applyTo: ['target'], name: '增耐' },
    life_steal: { stat: 'hp', op: 'gain', applyTo: ['starter'], name: '吸血' },
  };
  const m = map[type];
  if (!m) return null;
  return {
    displayName: (typeof raw.displayName === 'string' && raw.displayName.trim())
      ? raw.displayName.trim()
      : m.name,
    kind: 'instant',
    stat: m.stat,
    op: m.op,
    params: p,
    applyTo: Array.isArray(raw.applyTo) && raw.applyTo.length > 0
      ? (raw.applyTo as OnHitApplyTo[])
      : m.applyTo,
  };
}

/** 校验白名单；不合法返回 null */
function validateKindStatOp(effect: OnHitEffect): OnHitEffect | null {
  const kind = effectKind(effect);
  effect.kind = kind;
  if (kind === 'instant') {
    if (!isInstantStat(effect.stat)) return null;
    if (!OP_SET.has(effect.op)) return null;
    return effect;
  }
  // duration
  if (effect.op === 'set') return null;
  if ((effect.durationMs ?? 0) <= 0) return null;
  if (effect.buffKey == null) return null;
  const tick = effect.tickIntervalMs ?? 0;
  if (tick > 0) {
    if (!isInstantStat(effect.stat)) return null;
  } else {
    if (!isChassisStat(effect.stat)) return null;
  }
  return effect;
}

/** 将任意读档/API 条目规范为新结构；无法识别则返回 null */
export function normalizeOnHitEffect(raw: any): OnHitEffect | null {
  if (!raw || typeof raw !== 'object') return null;

  if (typeof raw.type === 'string' && raw.type && !raw.stat) {
    return migrateLegacyTypeEffect(raw);
  }

  const stat = raw.stat as OnHitStat;
  const op = raw.op as OnHitOp;
  if (!STAT_SET.has(stat) || !OP_SET.has(op)) return null;

  const paramsIn = (raw.params && typeof raw.params === 'object') ? raw.params : {};
  const params: { amount?: number; percent?: number } = {};
  if (Object.prototype.hasOwnProperty.call(paramsIn, 'amount')) {
    params.amount = Number(paramsIn.amount) || 0;
  }
  if (Object.prototype.hasOwnProperty.call(paramsIn, 'percent')) {
    params.percent = Number(paramsIn.percent) || 0;
  }

  const name = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  let kind: OnHitKind = raw.kind === 'duration' ? 'duration' : 'instant';
  // 缺省：无 kind 时若带 durationMs 则视为持续
  if (raw.kind === undefined && Number(raw.durationMs) > 0) kind = 'duration';

  const effect: OnHitEffect = {
    displayName: name,
    kind,
    stat,
    op,
    params,
  };

  if (kind === 'duration') {
    effect.durationMs = Math.max(0, Number(raw.durationMs) || 0);
    const tick = Number(raw.tickIntervalMs) || 0;
    if (tick > 0) effect.tickIntervalMs = tick;
    const key = typeof raw.buffKey === 'string' ? raw.buffKey.trim() : '';
    effect.buffKey = key;
  }

  if (Array.isArray(raw.applyTo) && raw.applyTo.length > 0) {
    effect.applyTo = raw.applyTo.filter((r: string) => APPLY_TO_SET.has(r as OnHitApplyTo));
  }

  return validateKindStatOp(effect);
}

export function normalizeOnHitEffects(list: any): OnHitEffect[] {
  if (!Array.isArray(list)) return [];
  const out: OnHitEffect[] = [];
  for (const item of list) {
    const n = normalizeOnHitEffect(item);
    if (n) out.push(n);
  }
  return out;
}

/** 实体旧 damage 字段注入为命中效果（仅当尚无 hp 类效果时） */
export function migrateLegacyDamageToOnHitEffects(
  onHitEffects: OnHitEffect[] | undefined,
  damage: number,
): OnHitEffect[] {
  const list = normalizeOnHitEffects(onHitEffects || []);
  if (!damage) return list;
  const hasHp = list.some(e => e.stat === 'hp' && (e.op === 'loss' || e.op === 'gain'));
  if (hasHp) return list;
  if (damage > 0) {
    list.unshift({
      displayName: '伤害',
      kind: 'instant',
      stat: 'hp',
      op: 'loss',
      params: { amount: damage },
      applyTo: ['target'],
    });
  } else {
    list.unshift({
      displayName: '回复',
      kind: 'instant',
      stat: 'hp',
      op: 'gain',
      params: { amount: Math.abs(damage) },
      applyTo: ['target'],
    });
  }
  return list;
}

/** 深拷贝效果列表（快照用） */
export function cloneOnHitEffects(list: OnHitEffect[]): OnHitEffect[] {
  return list.map(e => ({
    displayName: e.displayName,
    kind: e.kind || 'instant',
    durationMs: e.durationMs,
    tickIntervalMs: e.tickIntervalMs,
    buffKey: e.buffKey,
    stat: e.stat,
    op: e.op,
    params: { ...e.params },
    applyTo: e.applyTo ? [...e.applyTo] : undefined,
  }));
}

const APPLY_LABEL: Record<OnHitApplyTo, string> = {
  starter: '启动端',
  actionOwner: '被触发',
  target: '被命中',
};

const STAT_LABEL: Record<OnHitStat, string> = {
  hp: '血量',
  stamina: '耐力',
  remainingTime: '倒计时',
  maxHp: 'HP上限',
  maxStamina: '耐力上限',
  maxLoad: '负重上限',
  hpRegen: '生命恢复',
  staminaRegen: '耐力恢复',
  actionTime: '触发耗时',
  staminaCost: '耐力消耗',
  burden: '重压',
};

export function applyToLabel(role: OnHitApplyTo): string {
  return APPLY_LABEL[role];
}

export function statLabel(stat: OnHitStat): string {
  return STAT_LABEL[stat] || String(stat);
}

export function opSymbol(op: OnHitOp): string {
  if (op === 'gain') return '+';
  if (op === 'loss') return '-';
  return '→';
}

// ---- 空展示名 / buffKey 回退 ----

export function resolveHitDisplayName(effect: OnHitEffect, ownerName?: string): string {
  return resolveEffectIdentityRaw(effect.displayName, undefined, ownerName).displayName;
}

export function resolveHitBuffKey(effect: OnHitEffect, ownerName?: string): string {
  const result = resolveEffectIdentityRaw(effect.displayName, effect.buffKey, ownerName);
  return result.buffKey || '';
}

/** 战斗侧：遍历效果列表，对空 displayName / 空 buffKey 回填来源名。不写回模板库，仅操作内存中的 clone 副本 */
export function stampOnHitEffectList(list: OnHitEffect[], ownerName: string): void {
  for (const e of list) {
    if (!e.displayName.trim()) {
      e.displayName = resolveHitDisplayName(e, ownerName);
    }
    if (effectKind(e) === 'duration' && (!e.buffKey || !e.buffKey.trim())) {
      e.buffKey = resolveHitBuffKey(e, ownerName);
    }
  }
}

// ---- format ----

/** 配置面量：`10` / `20%` / `5 + 10%`；时间类固定值显示为秒 */
export function formatHitEffectMagnitude(effect: OnHitEffect): string {
  const n = normalizeOnHitEffect(effect) || effect;
  const amount = n.params?.amount;
  const percent = n.params?.percent;
  const hasAmount = Object.prototype.hasOwnProperty.call(n.params || {}, 'amount');
  const mag: string[] = [];
  if (hasAmount) {
    const showAmount = n.op === 'set' || amount !== 0 || percent === undefined || percent === 0;
    if (showAmount) {
      if ((n.stat === 'actionTime' || n.stat === 'remainingTime') && amount !== undefined) {
        mag.push(`${(amount / 1000).toFixed(1)}s`);
      } else {
        mag.push(String(amount ?? 0));
      }
    }
  }
  if (percent !== undefined && percent !== 0) mag.push(`${percent}%`);
  return mag.join(' + ');
}

export function formatHitEffectLine(effect: OnHitEffect, opts?: { showApplyTo?: boolean; ownerName?: string }): string {
  const n = normalizeOnHitEffect(effect) || effect;
  const parts: string[] = [n.displayName || (opts?.ownerName ? resolveHitDisplayName(n, opts.ownerName) : defaultDisplayName(n.stat, n.op))];
  if (opts?.showApplyTo) {
    const roles = resolveApplyTo(n);
    if (!(roles.length === 1 && roles[0] === 'target')) {
      parts.push(`(${roles.map(r => APPLY_LABEL[r]).join('/')})`);
    }
  }
  const mag = formatHitEffectMagnitude(n);
  const tickMs = n.tickIntervalMs ?? 0;
  const isDuration = effectKind(n) === 'duration' && (n.durationMs ?? 0) > 0;
  if (isDuration && tickMs > 0) {
    parts.push(`每${(tickMs / 1000).toFixed(1)}s`);
    if (mag) parts.push(mag);
    parts.push(`总${((n.durationMs as number) / 1000).toFixed(1)}s`);
  } else {
    if (mag) parts.push(mag);
    if (isDuration) parts.push(`总${((n.durationMs as number) / 1000).toFixed(1)}s`);
  }
  return parts.join(' ');
}

export function formatHitEffectsBlock(effects: OnHitEffect[] | undefined): string {
  const list = normalizeOnHitEffects(effects || []);
  if (list.length === 0) return '';
  return list.map(e => formatHitEffectLine(e, { showApplyTo: true })).join('\n');
}

export function formatHitEffectResultLine(
  displayName: string,
  value: number,
  op: OnHitOp,
  role: OnHitApplyTo,
): string {
  const roleLabel = APPLY_LABEL[role];
  if (op === 'set') return `${displayName} →${value}（${roleLabel}）`;
  if (op === 'gain') return `${displayName} +${value}（${roleLabel}）`;
  return `${displayName} -${value}（${roleLabel}）`;
}
