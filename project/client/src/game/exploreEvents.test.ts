import { describe, it, expect } from 'vitest';
import {
  EVENT_CHOICE_COUNT,
  EXPLORE_EVENT_DEFS,
  eventCanAppear,
  pickExploreEvents,
} from './exploreEvents';

describe('exploreEvents', () => {
  it('回合1必含 hire，且总数为 N（必出占坑）', () => {
    const picked = pickExploreEvents(1, 10, EVENT_CHOICE_COUNT, () => 0);
    expect(picked).toContain('hire');
    expect(picked.length).toBe(EVENT_CHOICE_COUNT);
  });

  it('回合3必含 open_path', () => {
    const picked = pickExploreEvents(3, 10, EVENT_CHOICE_COUNT, () => 0.99);
    expect(picked).toContain('open_path');
  });

  it('open_path 在第1回合不可出现，第5回合可随机', () => {
    const def = EXPLORE_EVENT_DEFS.find(d => d.id === 'open_path')!;
    expect(eventCanAppear(def, 1, 10)).toBe(false);
    expect(eventCanAppear(def, 3, 10)).toBe(true);
    expect(eventCanAppear(def, 5, 10)).toBe(true);
    expect(eventCanAppear(def, 7, 10)).toBe(true);
  });

  it('N=1 时 hire 仍出', () => {
    const picked = pickExploreEvents(1, 10, 1, () => 0);
    expect(picked).toEqual(['hire']);
  });
});
