const AVATAR_COLORS = ['#1a73e8', '#d93025', '#e37400', '#188038', '#9334e6', '#0d7377', '#c5221f', '#7c3aed'];

export function AddressAvatar({ name }: { name: string }) {
  const label = addressInitials(name);
  return (
    <span className="address-avatar" style={{ background: addressAvatarColor(name) }} aria-hidden="true">{label}</span>
  );
}

function addressInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

function addressAvatarColor(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}
