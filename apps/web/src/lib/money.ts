export function normalizeMoneyInput(value: string | number): string {
  const banglaDigits = "০১২৩৪৫৬৭৮৯";
  let text = String(value).trim().replace(/\s/g, "").replace(/,/g, "");
  text = text.replace(/[০-৯]/g, (digit) => String(banglaDigits.indexOf(digit)));
  const match = text.match(/^(\d{1,12})(?:\.(\d{0,2}))?/);
  if (!match) return text;
  return match[2] !== undefined && match[2] !== ""
    ? `${match[1]}.${match[2]}`
    : match[1]!;
}

export function parseMoneyAmount(value: string): number | null {
  const normalized = normalizeMoneyInput(value);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
