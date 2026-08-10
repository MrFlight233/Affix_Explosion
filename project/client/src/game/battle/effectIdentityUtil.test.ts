// 效果身份解析单测

import { describe, expect, it } from 'vitest';
import { resolveEffectIdentityRaw, FALLBACK_DISPLAY_NAME } from '@shared/effectIdentityUtil';

describe('resolveEffectIdentityRaw', () => {
  it('returns displayName when provided', () => {
    const result = resolveEffectIdentityRaw('伤害', undefined, '拳头');
    expect(result.displayName).toBe('伤害');
    expect(result.buffKey).toBeUndefined();
  });

  it('falls back to ownerName when displayName is empty', () => {
    const result = resolveEffectIdentityRaw('', undefined, '拳头');
    expect(result.displayName).toBe('拳头');
  });

  it('falls back to FALLBACK_DISPLAY_NAME when both displayName and ownerName are empty', () => {
    const result = resolveEffectIdentityRaw('', undefined, '');
    expect(result.displayName).toBe(FALLBACK_DISPLAY_NAME);
  });

  it('falls back to FALLBACK_DISPLAY_NAME when ownerName is undefined', () => {
    const result = resolveEffectIdentityRaw('', undefined, undefined);
    expect(result.displayName).toBe(FALLBACK_DISPLAY_NAME);
  });

  it('resolves buffKey: uses buffKey when provided', () => {
    const result = resolveEffectIdentityRaw('a', 'key1', 'owner');
    expect(result.buffKey).toBe('key1');
  });

  it('resolves buffKey: falls back to displayName when buffKey is empty', () => {
    const result = resolveEffectIdentityRaw('伤害', '', '拳头');
    expect(result.buffKey).toBe('伤害');
  });

  it('resolves buffKey: falls back to ownerName when both displayName and buffKey are empty', () => {
    const result = resolveEffectIdentityRaw('', '', '拳头');
    expect(result.buffKey).toBe('拳头');
  });

  it('resolves buffKey: falls back to FALLBACK_DISPLAY_NAME when all are empty', () => {
    const result = resolveEffectIdentityRaw('', '', '');
    expect(result.buffKey).toBe(FALLBACK_DISPLAY_NAME);
  });
});
