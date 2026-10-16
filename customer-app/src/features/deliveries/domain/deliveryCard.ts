const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shortDeliveryReference(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  const tail = compact.slice(-5).toUpperCase();
  return tail.length > 0 ? `#${tail}` : id;
}

export function deliveryWhenLabel(createdAt: string, now = new Date()): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const dateText = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  const time = `${hours}:${minutes}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / DAY_MS);
  if (dayDiff === 0) {
    return `Today, ${dateText} • ${time}`;
  }
  if (dayDiff === 1) {
    return `Yesterday, ${dateText} • ${time}`;
  }
  return `${dateText} • ${time}`;
}
