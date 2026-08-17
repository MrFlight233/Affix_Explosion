import { describe, it, expect } from 'vitest';
import {
  EVENT_CHOICE_COUNT,
  EXPLORE_EVENT_DEFS,
  eventCanAppear,
  pickExploreEvents,
} from './exploreEvents';

describe('exploreEvents', () => {
  it('回合1必出 hire（数量为 N，必出占槽）', () => {
    const rand = () => 0.1;
    const picked = pickExploreEvents(1, 10, EVENT_CHOICE_COUNT, rand);
    expect(picked[0]).toBe('hire');
    expect(picked).toContain('hire');
    expect(picked.length).toBe(EVENT_CHOICE_COUNT);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('回合3必出 open_path', () => {
    const picked = pickExploreEvents(3, 10, EVENT_CHOICE_COUNT, () => 0.99);
    expect(picked).toContain('open_path');
  });

  it('open_path 在第1回合不可出现，第5回合起可抽', () => {
    const def = EXPLORE_EVENT_DEFS.find(d => d.id === 'open_path')!;
    expect(eventCanAppear(def, 1, 10)).toBe(false);
    expect(eventCanAppear(def, 3, 10)).toBe(true);
    expect(eventCanAppear(def, 5, 10)).toBe(true);
    expect(eventCanAppear(def, 7, 10)).toBe(true);
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

  it('必出数突破 N / N=1 时 hire 独占', () => {
    const picked = pickExploreEvents(1, 10, 1, () => 0);
    expect(picked).toEqual(['hire']);
  });
});
