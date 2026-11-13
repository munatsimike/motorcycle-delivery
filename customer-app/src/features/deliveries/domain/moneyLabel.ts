export function currencyMark(currency: string): string {
  return currency.trim().toUpperCase() === 'USD' ? '$' : currency.trim();
}

export function moneyLabel(currency: string, amount: string): string {
  const mark = currencyMark(currency);
  return mark === '$' ? `${mark}${amount}` : `${mark} ${amount}`;
}
