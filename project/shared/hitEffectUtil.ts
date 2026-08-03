// 命中效果：规范化、迁移、展示（数值变化管道）

export type OnHitApplyTo = 'starter' | 'actionOwner' | 'target';
export type OnHitStat = 'hp' | 'stamina';
export type OnHitOp = 'gain' | 'loss' | 'set';

export interface OnHitEffect {
  displayName: string;
  stat: OnHitStat;
  op: OnHitOp;
  params: { amount?: number; percent?: number };
  applyTo?: OnHitApplyTo[];
}

const APPLY_TO_SET = new Set<OnHitApplyTo>(['starter', 'actionOwner', 'target']);
const STAT_SET = new Set<OnHitStat>(['hp', 'stamina']);
const OP_SET = new Set<OnHitOp>(['gain', 'loss', 'set']);

export function defaultDisplayName(stat: OnHitStat, op: OnHitOp): string {
  if (stat === 'hp' && op === 'loss') return '伤害';
  if (stat === 'hp' && op === 'gain') return '回复';
  if (stat === 'hp' && op === 'set') return 'HP变为';
  if (stat === 'stamina' && op === 'loss') return '削耐';
  if (stat === 'stamina' && op === 'gain') return '增耐';
  if (stat === 'stamina' && op === 'set') return '耐力变为';
  return '效果';
}

export function resolveApplyTo(effect: OnHitEffect): OnHitApplyTo[] {
  const raw = effect.applyTo;
  if (!raw || raw.length === 0) return ['target'];
  const out = raw.filter((r): r is OnHitApplyTo => APPLY_TO_SET.has(r as OnHitApplyTo));
  return out.length > 0 ? out : ['target'];
}

/** 百分比向下取整后与固定值相加 */
export function computeHitEffectValue(
  hitMagnitude: number,
  params: { amount?: number; percent?: number } | undefined,
): number {
  const amount = params?.amount ?? 0;
  const percent = params?.percent ?? 0;
  const percentPart = Math.floor(hitMagnitude * percent / 100);
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
    stat: m.stat,
    op: m.op,
    params: p,
    applyTo: Array.isArray(raw.applyTo) && raw.applyTo.length > 0
      ? (raw.applyTo as OnHitApplyTo[])
      : m.applyTo,
  };
}

/** 将任意读档/API 条目规范为新结构；无法识别则返回 null */
export function normalizeOnHitEffect(raw: any): OnHitEffect | null {
  if (!raw || typeof raw !== 'object') return null;

  // 旧 type 表
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
  const effect: OnHitEffect = {
    displayName: name || defaultDisplayName(stat, op),
    stat,
    op,
    params,
  };
  if (Array.isArray(raw.applyTo) && raw.applyTo.length > 0) {
    effect.applyTo = raw.applyTo.filter((r: string) => APPLY_TO_SET.has(r as OnHitApplyTo));
  }
  return effect;
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
      stat: 'hp',
      op: 'loss',
      params: { amount: damage },
      applyTo: ['target'],
    });
  } else {
    list.unshift({
      displayName: '回复',
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
};

export function applyToLabel(role: OnHitApplyTo): string {
  return APPLY_LABEL[role];
}

export function statLabel(stat: OnHitStat): string {
  return STAT_LABEL[stat];
}

export function opSymbol(op: OnHitOp): string {
  if (op === 'gain') return '+';
  if (op === 'loss') return '-';
  return '→';
}

/** 配置面量：`10` / `20%` / `5 + 10%` */
export function formatHitEffectMagnitude(effect: OnHitEffect): string {
  const n = normalizeOnHitEffect(effect) || effect;
  const amount = n.params?.amount;
  const percent = n.params?.percent;
  const hasAmount = Object.prototype.hasOwnProperty.call(n.params || {}, 'amount');
  const mag: string[] = [];
  if (hasAmount) {
    const showAmount = n.op === 'set' || amount !== 0 || percent === undefined || percent === 0;
    if (showAmount) mag.push(String(amount ?? 0));
  }
  if (percent !== undefined && percent !== 0) mag.push(`${percent}%`);
  return mag.join(' + ');
}

export function formatHitEffectLine(effect: OnHitEffect, opts?: { showApplyTo?: boolean }): string {
  const n = normalizeOnHitEffect(effect) || effect;
  const parts: string[] = [n.displayName || defaultDisplayName(n.stat, n.op)];
  const mag = formatHitEffectMagnitude(n);
  if (mag) parts.push(mag);
  if (opts?.showApplyTo) {
    const roles = resolveApplyTo(n);
    if (!(roles.length === 1 && roles[0] === 'target')) {
      parts.push(`(${roles.map(r => APPLY_LABEL[r]).join('/')})`);
    }
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
