// 主动动作 / 命中效果展示文案（配置面三块 + 战斗日志）

import type { OnHitEffect, OnHitApplyTo, OnHitOp, OnHitStat } from './hitEffectUtil';
import {
  applyToLabel,
  defaultDisplayName,
  formatHitEffectMagnitude,
  normalizeOnHitEffect,
  normalizeOnHitEffects,
  opSymbol,
  resolveApplyTo,
  statLabel,
} from './hitEffectUtil';
import { formatTargetingSummary } from './targetingUtil';

export interface CombatLogEffectLine {
  displayName: string;
  affectedName: string;
  stat: OnHitStat;
  op: OnHitOp;
  value: number;
  before: number;
  after: number;
  role?: OnHitApplyTo;
}

export interface CombatLogHeaderInput {
  time: number;
  actorName: string;
  targetName: string;
  weaponName: string;
}

/** 配置面效果行：每条效果一行；多 applyTo 用 / 合并角色；持续用「每/总」时长 */
export function formatConfigEffectLines(effect: OnHitEffect): string[] {
  const n = normalizeOnHitEffect(effect);
  if (!n) return [];
  const name = n.displayName || defaultDisplayName(n.stat, n.op);
  const mag = formatHitEffectMagnitude(n);
  const sym = opSymbol(n.op);
  const st = statLabel(n.stat);
  const roleLabels = resolveApplyTo(n).map(applyToLabel).join('/');
  const isDuration = (n.kind === 'duration' || (n.durationMs ?? 0) > 0) && (n.durationMs ?? 0) > 0;
  const tickMs = n.tickIntervalMs ?? 0;

  if (isDuration && tickMs > 0) {
    // Tick 壳：毒 被命中 每1.0s 血量 - 5 总2.0s
    const every = `${(tickMs / 1000).toFixed(1)}s`;
    const total = `${((n.durationMs as number) / 1000).toFixed(1)}s`;
    const mid = mag ? `${st} ${sym} ${mag}` : `${st} ${sym}`;
    return [`${name} ${roleLabels} 每${every} ${mid} 总${total}`];
  }

  let base = `${name} ${roleLabels} ${st} ${sym}`;
  if (mag) base = `${base} ${mag}`;
  if (isDuration) {
    // 底盘持续：鼓舞 被命中 生命恢复 + 2 总5.0s
    base = `${base} 总${((n.durationMs as number) / 1000).toFixed(1)}s`;
  }
  return [base];
}

export function formatConfigEffectsBlock(effects: OnHitEffect[] | undefined): string[] {
  const out: string[] = [];
  for (const e of normalizeOnHitEffects(effects || [])) {
    out.push(...formatConfigEffectLines(e));
  }
  return out;
}

export function formatActionCostSummary(staminaCost: number, actionTimeMs: number): string {
  return `耐力 ${staminaCost} · 间隔 ${(actionTimeMs / 1000).toFixed(1)}s`;
}

export function formatActionCostStamina(staminaCost: number): string {
  return `耐力 ${staminaCost}`;
}

export function formatActionCostTime(actionTimeMs: number, remainingMs?: number): string {
  if (remainingMs !== undefined) {
    return `倒计时 ${(Math.max(remainingMs, 0) / 1000).toFixed(1)}s`;
  }
  return `间隔 ${(actionTimeMs / 1000).toFixed(1)}s`;
}

export function formatActionTargetSummary(input: Parameters<typeof formatTargetingSummary>[0]): string {
  return formatTargetingSummary(input);
}

/** 折叠摘要：耐耗N · 目标 · 首条效果名 */
export function formatActiveActionCollapseSummary(opts: {
  staminaCost: number;
  targetingSummary: string;
  effects: OnHitEffect[] | undefined;
}): string {
  const list = normalizeOnHitEffects(opts.effects || []);
  let effectPart = '无效果';
  if (list.length === 1) {
    effectPart = list[0].displayName || defaultDisplayName(list[0].stat, list[0].op);
  } else if (list.length > 1) {
    const first = list[0].displayName || defaultDisplayName(list[0].stat, list[0].op);
    effectPart = `${first}等${list.length}条`;
  }
  return `耐耗${opts.staminaCost} · ${opts.targetingSummary} · ${effectPart}`;
}

export function formatCombatLogHeader(evt: CombatLogHeaderInput): string {
  return `[${(evt.time / 1000).toFixed(1)}s] ${evt.actorName} 对 ${evt.targetName} 使用 ${evt.weaponName}`;
}

export function formatCombatEffectLine(line: CombatLogEffectLine): string {
  const pool = line.stat === 'hp' ? 'HP' : line.stat === 'stamina' ? '耐力' : statLabel(line.stat);
  const sym = opSymbol(line.op);
  const st = statLabel(line.stat);
  const before = Math.round(line.before);
  const after = Math.round(line.after);
  return `${line.displayName} ${line.affectedName} ${st} ${sym} ${line.value}  (${pool}: ${before} -> ${after})`;
}

export function formatCombatKillLine(time: number, targetName: string): string {
  return `[${(time / 1000).toFixed(1)}s] ${targetName} 击杀!`;
}

/** 战斗日志 HTML 片段（共用） */
export function formatCombatEventLogHtml(evt: {
  time: number;
  actorName: string;
  weaponName: string;
  targetName: string;
  effects: string[];
}): string {
  if (evt.effects?.includes('击杀')) {
    return `<div class="sb-log-entry kill">${formatCombatKillLine(evt.time, evt.targetName)}</div>`;
  }
  if (evt.targetName === '战斗开始') {
    return `<div class="sb-log-entry">[0.0s] 战斗开始</div>`;
  }
  if (evt.effects?.includes('空池自动获胜') || evt.targetName === '玩家胜利') {
    return `<div class="sb-log-entry">[0.0s] 对战池无对手 · 自动获胜</div>`;
  }
  if (evt.targetName === '超时惩罚') {
    const sec = evt.effects?.[0] || '';
    return `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s] 超时惩罚 ${sec}</div>`;
  }
  if (!evt.actorName && !evt.weaponName) {
    // 持续 Tick 等无攻击方事件：时间戳 + 效果子行
    if (evt.effects?.length) {
      let h = `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s]</div>`;
      for (const eff of evt.effects) {
        if (eff === '击杀') continue;
        h += `<div class="sb-log-entry" style="padding-left:20px">${eff}</div>`;
      }
      return h;
    }
    return `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s] ${evt.targetName}</div>`;
  }
  let h = `<div class="sb-log-entry">${formatCombatLogHeader(evt)}</div>`;
  for (const eff of evt.effects || []) {
    if (eff === '击杀') continue;
    h += `<div class="sb-log-entry" style="padding-left:20px">${eff}</div>`;
  }
  return h;
}
