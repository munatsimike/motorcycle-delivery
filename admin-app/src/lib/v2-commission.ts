const PERCENTAGE = /^(?:0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/;

export function basisPointsFromCommissionPercentage(input: string): number | null {
  const value = input.trim().replace(/%$/, '');
  const match = PERCENTAGE.exec(value);
  if (!match) {
    return null;
  }
  const fraction = match[1] ?? '';
  const basisPoints = Number(value.split('.')[0]) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    return null;
  }
  return basisPoints;
}
