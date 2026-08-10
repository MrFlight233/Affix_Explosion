// 效果身份：空展示名 / 空 buffKey 的统一回退解析
// displayName → ownerName → 「未命名效果」

export const FALLBACK_DISPLAY_NAME = '未命名效果';

export function resolveEffectIdentityRaw(
  displayName: string | undefined,
  buffKey: string | undefined,
  ownerName: string | undefined,
): { displayName: string; buffKey?: string } {
  const resolved = displayName?.trim() || ownerName?.trim() || FALLBACK_DISPLAY_NAME;
  const result: { displayName: string; buffKey?: string } = { displayName: resolved };
  if (buffKey !== undefined) {
    result.buffKey = buffKey.trim() || resolved;
  }
  return result;
}
