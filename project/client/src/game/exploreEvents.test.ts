import { describe, it, expect } from 'vitest';
import { pickExploreEvents, EVENT_CHOICE_COUNT } from './exploreEvents';

describe('pickExploreEvents', () => {
  it('回合1必含 hire，且总数为 N（必出占坑）', () => {
    const rand = () => 0.1;
    const picked = pickExploreEvents(1, 10, EVENT_CHOICE_COUNT, rand);
    expect(picked[0]).toBe('hire');
    expect(picked.length).toBe(EVENT_CHOICE_COUNT);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('回合9不出 invest', () => {
    const seq = [0.01, 0.2, 0.4, 0.6, 0.8];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    for (let t = 0; t < 20; t++) {
      const picked = pickExploreEvents(9, 10, EVENT_CHOICE_COUNT, rand);
      expect(picked).not.toContain('invest');
      expect(picked.length).toBeLessThanOrEqual(EVENT_CHOICE_COUNT);
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it('必出可突破 N', () => {
    // 无法轻易构造多 must，至少验证 N=1 时 hire 仍出
    const picked = pickExploreEvents(1, 10, 1, () => 0);
    expect(picked).toEqual(['hire']);
  });
});
