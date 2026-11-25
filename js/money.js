// Money is always an integer number of paise (1 rupee = 100 paise). Never a float.
// Pure functions, no DOM: unit-tested in tests/money.test.js.

const MAX_PAISE = 99_99_99_99_999_99; // ₹99,99,99,99,999.99: far beyond any personal expense, still a safe integer

/**
 * Parse what someone typed into an amount field into paise.
 * Accepts "250", "250.5", "1,25,000", "₹ 99.99", ".75". Rounds half up at the paise
 * (third decimal), working on the digits so float error can never creep in.
 * Returns null for empty, negative, malformed or absurd input.
 */
export function parseAmount(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [intStr = '', fracStr = ''] = s.split('.');
  const intDigits = intStr.replace(/^0+(?=\d)/, '');
  if (intDigits.length > 14) return null;
  const f = (fracStr + '000').slice(0, 3);
  let paise = Number(intDigits || '0') * 100 + Number(f.slice(0, 2));
  if (Number(f[2]) >= 5) paise += 1;
  if (!Number.isSafeInteger(paise) || paise > MAX_PAISE) return null;
  return paise;
}

/** A signed amount in paise (goal adds are negative for withdrawals). */
export const isSignedPaise = (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_PAISE;

export const isPaise = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_PAISE;

/** Indian digit grouping of a non-negative integer string: 125000 → "1,25,000", 12345678 → "1,23,45,678". */
export function groupIndian(n) {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Format paise as rupees: 12500000 → "₹1,25,000", 12550 → "₹125.50".
 *   decimals: 'auto' (show paise only when there are any), 'always', 'never' (rounds half up to the rupee)
 *   sign: true puts "+" on positive amounts (for differences)
 */
export function formatINR(paise, { decimals = 'auto', sign = false } = {}) {
  const neg = paise < 0;
  let abs = Math.abs(Math.trunc(paise));
  let rupees;
  let frac = '';
  if (decimals === 'never') {
    rupees = Math.floor((abs + 50) / 100);
  } else {
    rupees = Math.floor(abs / 100);
    const p = abs % 100;
    if (decimals === 'always' || p !== 0) frac = `.${String(p).padStart(2, '0')}`;
  }
  const pre = neg ? '−' : sign && abs > 0 ? '+' : '';
  return `${pre}₹${groupIndian(rupees)}${frac}`;
}

/** Short form for chart labels: ₹950, ₹12.5K, ₹1.2L, ₹3.4Cr. */
export function formatCompact(paise) {
  const r = Math.round(Math.abs(paise) / 100);
  const neg = paise < 0 ? '−' : '';
  const one = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  if (r >= 1_00_00_000) return `${neg}₹${one(r / 1_00_00_000)}Cr`;
  if (r >= 1_00_000) return `${neg}₹${one(r / 1_00_000)}L`;
  if (r >= 1_000) return `${neg}₹${one(r / 1_000)}K`;
  return `${neg}₹${r}`;
}

/** Paise back into an editable string: 12550 → "125.50", 950000 → "9500" (or "9,500" with group). */
export function paiseToInput(paise, { group = false } = {}) {
  if (!Number.isSafeInteger(paise)) return '';
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  const rs = group ? groupIndian(r) : String(r);
  return p ? `${rs}.${String(p).padStart(2, '0')}` : rs;
}

/**
 * Percentage change from prev to cur, rounded to a whole percent (half away from zero).
 * null when there is nothing to compare with (prev is 0 and cur isn't).
 */
export function pctChange(cur, prev) {
  if (prev === 0) return cur === 0 ? 0 : null;
  const raw = ((cur - prev) * 100) / prev;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Whole percent of budget used, rounded down so 79.9 % never shows as 80 %. null when budget is 0. */
export function pctUsed(spent, budget) {
  if (!(budget > 0)) return null;
  return Math.floor((spent * 100) / budget);
}

/**
 * Progress state for a bar: 'ok', 'warn' (80 % or more used), 'over' (spent more than the budget).
 * Integer maths only: spent*5 >= budget*4 is spent/budget >= 0.8.
 */
export function budgetStatus(spent, budget) {
  if (budget <= 0) return spent > 0 ? 'over' : 'ok';
  if (spent > budget) return 'over';
  if (spent * 5 >= budget * 4) return 'warn';
  return 'ok';
}

export const sum = (values) => values.reduce((a, b) => a + b, 0);
