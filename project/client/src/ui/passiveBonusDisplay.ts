// 被动加成展示（卡面 / tooltip / 物池）

import {
  formatPassiveEffectLine,
  isSelfOnlyPassiveTarget,
  resolvePassiveBonusConfig,
  type PassiveBonusConfig,
  type PassiveEffect,
} from '../game/passiveBonusUtil';
import { formatTargetingSummary } from '../game/targetingUtil';
import { formatWeightBonusG } from './build/format';

export function resolvePassiveForDisplay(raw: {
  hasPassiveBonuses?: boolean;
  passiveEffects?: unknown;
  passiveTargetCondition?: unknown;
  passiveTargetCount?: unknown;
  hpBonus?: number;
  hpRegenerationBonus?: number;
  staminaBonus?: number;
  staminaRegenerationBonus?: number;
  loadBonus?: number;
}): PassiveBonusConfig {
  return resolvePassiveBonusConfig(raw as any);
}

export function hasDisplayPassive(raw: Parameters<typeof resolvePassiveForDisplay>[0]): boolean {
  const cfg = resolvePassiveForDisplay(raw);
  return cfg.hasPassiveBonuses && cfg.passiveEffects.length > 0;
}

/** maxLoad 用克制单位展示，其余用数值 */
export function formatPassiveEffectDisplay(e: PassiveEffect): string {
  if (e.stat === 'maxLoad') {
    const signed = e.op === 'loss' ? -e.params.amount : e.params.amount;
    return `${e.displayName} ${formatWeightBonusG(signed)}`;
  }
  return formatPassiveEffectLine(e);
}

export function formatPassiveTargetLine(cfg: PassiveBonusConfig): string {
  return formatTargetingSummary({
    sortBy: cfg.passiveTargetCondition.sortBy,
    filterBy: cfg.passiveTargetCondition.filterBy,
    targetCount: cfg.passiveTargetCount,
  });
}

/** 非「仅自己」时附加根维持说明 */
export function passiveRootHint(cfg: PassiveBonusConfig): string | null {
  if (!cfg.hasPassiveBonuses || cfg.passiveEffects.length === 0) return null;
  if (isSelfOnlyPassiveTarget(cfg.passiveTargetCondition)) return null;
  return '由所在第一层实体维持，其阵亡后失效';
}

export function passiveEffectPlainLines(cfg: PassiveBonusConfig): string[] {
  return cfg.passiveEffects.map(formatPassiveEffectDisplay);
}

/** 折叠摘要：目标 · 首条效果名（多条则「等N条」） */
export function formatPassiveCollapseSummary(cfg: PassiveBonusConfig): string {
  if (!cfg.hasPassiveBonuses || cfg.passiveEffects.length === 0) return '';
  const targeting = formatPassiveTargetLine(cfg);
  const list = cfg.passiveEffects;
  let effectPart = list[0].displayName || formatPassiveEffectDisplay(list[0]);
  if (list.length > 1) {
    effectPart = `${effectPart}等${list.length}条`;
  }
  return `${targeting} · ${effectPart}`;
}
