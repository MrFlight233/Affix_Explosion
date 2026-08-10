// 主动动作展示文案单测

import { describe, expect, it } from 'vitest';
import {
  formatActiveActionCollapseSummary,
  formatCombatEffectLine,
  formatCombatEventLogHtml,
  formatCombatLogHeader,
  formatConfigEffectLines,
} from './activeActionDisplay';

describe('formatConfigEffectLines', () => {
  it('多 applyTo 合并为 / 连接的一行', () => {
    const lines = formatConfigEffectLines({
      displayName: '削耐',
      stat: 'stamina',
      op: 'loss',
      params: { amount: 5, percent: 10 },
      applyTo: ['target', 'starter'],
    });
    expect(lines).toEqual([
      '削耐 被命中/启动端 耐力 - 5 + 10%',
    ]);
  });

  it('仅百分与 set', () => {
    expect(formatConfigEffectLines({
      displayName: '伤',
      stat: 'hp',
      op: 'loss',
      params: { percent: 20 },
    })).toEqual(['伤 被命中 血量 - 20%']);
    expect(formatConfigEffectLines({
      displayName: '锁血',
      stat: 'hp',
      op: 'set',
      params: { amount: 10 },
    })).toEqual(['锁血 被命中 血量 → 10']);
  });

  it('三角色合并', () => {
    expect(formatConfigEffectLines({
      displayName: '伤害',
      stat: 'hp',
      op: 'loss',
      params: { amount: 10 },
      applyTo: ['target', 'actionOwner', 'starter'],
    })).toEqual(['伤害 被命中/被触发/启动端 血量 - 10']);
  });

  it('Tick 壳：每间隔 + 总量时长', () => {
    expect(formatConfigEffectLines({
      displayName: '毒',
      kind: 'duration',
      durationMs: 2000,
      tickIntervalMs: 1000,
      buffKey: 'poison',
      stat: 'hp',
      op: 'loss',
      params: { amount: 5 },
      applyTo: ['target'],
    })).toEqual(['毒 被命中 每1.0s 血量 - 5 总2.0s']);
  });

  it('底盘持续：总时长', () => {
    expect(formatConfigEffectLines({
      displayName: '鼓舞',
      kind: 'duration',
      durationMs: 5000,
      buffKey: 'inspire',
      stat: 'hpRegen',
      op: 'gain',
      params: { amount: 2 },
      applyTo: ['target'],
    })).toEqual(['鼓舞 被命中 生命恢复 + 2 总5.0s']);
  });
});

describe('combat log lines', () => {
  it('抬头与子行', () => {
    expect(formatCombatLogHeader({
      time: 1000,
      actorName: '人类',
      targetName: '哥布林',
      weaponName: '拳头',
    })).toBe('[1.0s] 人类 对 哥布林 使用 拳头');
    expect(formatCombatEffectLine({
      displayName: '伤害',
      affectedName: '哥布林',
      stat: 'hp',
      op: 'loss',
      value: 10,
      before: 50,
      after: 40,
    })).toBe('伤害 哥布林 血量 - 10  (HP: 50 -> 40)');
  });

  it('持续 Tick 独立事件：无攻击方时仍渲染效果子行', () => {
    const html = formatCombatEventLogHtml({
      time: 2000,
      actorName: '',
      weaponName: '',
      targetName: '哥布林',
      effects: ['毒 哥布林 血量 - 5  (HP: 535 -> 530)'],
    });
    expect(html).toContain('[2.0s]');
    expect(html).toContain('毒 哥布林 血量 - 5');
    expect(html).not.toMatch(/\[2\.0s\] 哥布林</);
  });
});

describe('collapse summary', () => {
  it('多效果摘要', () => {
    expect(formatActiveActionCollapseSummary({
      staminaCost: 10,
      targetingSummary: '敌人·随机·1',
      effects: [
        { displayName: '伤害', stat: 'hp', op: 'loss', params: { amount: 1 } },
        { displayName: '吸血', stat: 'hp', op: 'gain', params: { amount: 1 }, applyTo: ['starter'] },
      ],
    })).toBe('耐耗10 · 敌人·随机·1 · 伤害等2条');
  });
});

describe('format with ownerName fallback', () => {
  it('formatConfigEffectLines uses ownerName when displayName is empty', () => {
    const lines = formatConfigEffectLines({
      displayName: '',
      stat: 'hp',
      op: 'loss',
      params: { amount: 5 },
      applyTo: ['target'],
    }, '拳头');
    expect(lines[0]).toContain('拳头');
    expect(lines[0]).not.toContain('伤害');
  });

  it('formatActiveActionCollapseSummary uses ownerName when displayName is empty', () => {
    const summary = formatActiveActionCollapseSummary({
      staminaCost: 10,
      targetingSummary: '敌人·随机·1',
      ownerName: '拳头',
      effects: [
        { displayName: '', stat: 'hp', op: 'loss', params: { amount: 1 } },
      ],
    });
    expect(summary).toContain('拳头');
    expect(summary).toContain('耐耗10');
  });
});
