// 被动加成展示（卡面 / tooltip / 物池）

import {
  formatPassiveEffectLine,
  isRootOnlyPassiveTarget,
  resolvePassiveBonusConfig,
  type PassiveBonusConfig,
  type PassiveEffect,
} from '../game/passiveBonusUtil';
import {
  conditionPreviewPrefix,
  formatTargetingSummary,
} from '../game/targetingUtil';
import {
  AFFIX_DEFS,
  countMatchingAffixesInSubtree,
  evaluateSubtreeCondition,
  type ItemInstance,
} from '../game/data';
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
export function formatPassiveEffectDisplay(e: PassiveEffect, ownerName?: string): string {
  if (e.stat === 'maxLoad') {
    const signed = e.op === 'loss' ? -e.params.amount : e.params.amount;
    return `${e.displayName || ownerName || '未命名效果'} ${formatWeightBonusG(signed)}`;
  }
  return formatPassiveEffectLine(e, ownerName);
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
  if (isRootOnlyPassiveTarget(cfg.passiveTargetCondition)) return null;
  return '由所在第一层实体维持，其阵亡后失效';
}

export function defaultAffixOptsForPreview(): { id: string; name: string }[] {
  return AFFIX_DEFS.map(a => ({ id: a.id, name: a.name }));
}

export function isPassiveEffectActive(
  e: PassiveEffect,
  roots?: ItemInstance[] | null,
): boolean {
  if (!e.condition?.matchIds?.length) return true;
  if (!roots?.length) return true; // 无树：配置预览，视为正常色
  return evaluateSubtreeCondition(e.condition, roots);
}

/** 制作页风格预览行；有 roots 时带（现 k） */
export function formatPassiveEffectPreviewLine(
  e: PassiveEffect,
  opts?: {
    ownerName?: string;
    affixOpts?: { id: string; name: string }[];
    roots?: ItemInstance[] | null;
  },
): string {
  const affixOpts = opts?.affixOpts ?? defaultAffixOptsForPreview();
  const roots = opts?.roots;
  let currentCount: number | undefined;
  if (e.condition?.matchIds?.length && roots?.length) {
    currentCount = countMatchingAffixesInSubtree(roots, e.condition.matchIds);
  }
  const prefix = conditionPreviewPrefix(e.condition, affixOpts, currentCount);
  return prefix + formatPassiveEffectDisplay(e, opts?.ownerName);
}

export function getPassiveEffectDisplayRows(
  cfg: PassiveBonusConfig,
  roots?: ItemInstance[] | null,
  ownerName?: string,
): { text: string; active: boolean }[] {
  const affixOpts = defaultAffixOptsForPreview();
  return cfg.passiveEffects.map(e => ({
    text: formatPassiveEffectPreviewLine(e, { ownerName, affixOpts, roots }),
    active: isPassiveEffectActive(e, roots),
  }));
}

export function passiveEffectPlainLines(cfg: PassiveBonusConfig, ownerName?: string): string[] {
  return cfg.passiveEffects.map(e => formatPassiveEffectDisplay(e, ownerName));
}

/** 折叠摘要：目标 · 首条效果名（多条则「等N条」） */
export function formatPassiveCollapseSummary(cfg: PassiveBonusConfig, ownerName?: string): string {
  if (!cfg.hasPassiveBonuses || cfg.passiveEffects.length === 0) return '';
  const targeting = formatPassiveTargetLine(cfg);
  const list = cfg.passiveEffects;
  const owner = ownerName?.trim();
  let effectPart = list[0].displayName || owner || formatPassiveEffectDisplay(list[0]);
  if (list.length > 1) {
    effectPart = `${effectPart}等${list.length}条`;
  }
  return `${targeting} · ${effectPart}`;
}
