const exactNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const units = [
  { size: 1e15, suffix: "Q" },
  { size: 1e12, suffix: "T" },
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "K" },
] as const;

function safeValue(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Compact balances never round up to money or units the player does not own. */
export function formatHudNumber(value: number, paired = false): string {
  const amount = safeValue(value);
  if (amount < 1_000) return String(Math.floor(amount * 10) / 10);
  if (amount < 10_000) return exactNumber.format(Math.floor(amount));

  // Beyond Q, a single significant digit keeps even e308 within five characters.
  if (amount >= 1e18) {
    const [mantissa, exponent] = amount.toExponential().split("e");
    return `${mantissa[0]}e${Number(exponent)}`;
  }

  const unit = units.find((candidate) => amount >= candidate.size)!;
  const scaled = amount / unit.size;
  const digits = scaled >= 100 && paired ? 0 : scaled >= 10 ? 1 : 2;
  // Divide by an integer step before truncation. Multiplying a fractional
  // scaled value can turn an exact 1.13 M into 1.12 M through float round-off.
  const step = unit.size / 10 ** digits;
  let steps = Math.floor(amount / step);
  if (steps * step > amount) steps -= 1;
  return `${(steps / 10 ** digits).toFixed(digits)}${unit.suffix}`;
}

/** Full balances for detail views, with separators and at most one decimal. */
export function formatHudExact(value: number): string {
  return exactNumber.format(safeValue(value));
}

/** Returns an unsigned increment; the caller supplies the leading +. */
export function formatHudGain(value: number): string {
  const amount = safeValue(value);
  if (amount === 0 || amount >= 0.1) return formatHudNumber(amount);

  // Tiny positive production increments must remain visible instead of +0.
  const [mantissa, exponentText] = amount.toExponential().split("e");
  const digit = Number(mantissa[0]);
  const exponent = Number(exponentText);
  if (exponent >= -3) return (digit * 10 ** exponent).toFixed(-exponent);
  return `${digit}e${exponent}`;
}
