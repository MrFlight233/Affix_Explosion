/** 克 → 展示：|g|<1000 用 g，否则 kg（整除用整数，否则最多 3 位去尾零） */
export function formatWeightG(grams: number): string {
  const n = Number(grams) || 0;
  const abs = Math.abs(n);
  if (abs < 1000) return `${n}g`;
  const kg = n / 1000;
  const s = Number.isInteger(kg) ? String(kg) : String(parseFloat(kg.toFixed(3)));
  return `${s}kg`;
}

/** 负重加成带符号：+2kg / -500g */
export function formatWeightBonusG(grams: number): string {
  const n = Number(grams) || 0;
  if (n === 0) return '0g';
  const body = formatWeightG(Math.abs(n));
  return n > 0 ? `+${body}` : `-${body}`;
}
