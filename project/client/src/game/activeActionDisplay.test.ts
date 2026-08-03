// 主动动作展示文案单测

import { describe, expect, it } from 'vitest';
import {
  formatActiveActionCollapseSummary,
  formatCombatEffectLine,
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
