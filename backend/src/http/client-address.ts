const MATCH_ALL_CIDRS = new Set(['0.0.0.0/0', '::/0']);

export function trustedProxyCidrs(configured: string | undefined): string[] {
  if (!configured) {
    return [];
  }
  const cidrs: string[] = [];
  for (const entry of configured.split(',')) {
    const cidr = entry.trim().toLowerCase();
    if (!cidr || MATCH_ALL_CIDRS.has(cidr) || !isCidr(cidr)) {
      continue;
    }
    cidrs.push(cidr);
  }
  return cidrs;
}

export function railwayEdgeClientIpEnabled(configured: string | undefined): boolean {
  return configured === 'true';
}

export function resolveClientAddress(input: {
  socketAddress: string | undefined;
  forwardedFor?: string | string[] | undefined;
  realIp?: string | string[] | undefined;
  trustedProxyCidrs: readonly string[];
  trustRailwayEdgeClientIp?: boolean;
}): string {
  const socketAddress = normalizeIp(input.socketAddress);
  if (input.trustRailwayEdgeClientIp) {
    return exactlyOneIp(input.realIp) ?? socketAddress ?? 'unknown';
  }
  if (!socketAddress) {
    return 'unknown';
  }
  if (!input.trustedProxyCidrs.some((cidr) => matchesCidr(socketAddress, cidr))) {
    return socketAddress;
  }
  const realIp = singleIp(input.realIp);
  if (realIp) {
    return realIp;
  }
  const forwarded = forwardedAddresses(input.forwardedFor);
  return forwarded[forwarded.length - 1] ?? socketAddress;
}

export function rateLimitAddress(request: {
  socket?: { remoteAddress?: string | undefined };
  headers: { [name: string]: string | string[] | undefined };
}, configuredProxies: string | undefined, trustRailwayEdgeClientIp?: string | undefined): string {
  return resolveClientAddress({
    socketAddress: request.socket?.remoteAddress,
    forwardedFor: request.headers['x-forwarded-for'],
    realIp: request.headers['x-real-ip'],
    trustedProxyCidrs: trustedProxyCidrs(configuredProxies),
    trustRailwayEdgeClientIp: railwayEdgeClientIpEnabled(trustRailwayEdgeClientIp),
  });
}

function forwardedAddresses(value: string | string[] | undefined): string[] {
  const header = Array.isArray(value) ? value[value.length - 1] : value;
  if (!header) {
    return [];
  }
  const addresses: string[] = [];
  for (const entry of header.split(',')) {
    const address = normalizeIp(entry);
    if (address) {
      addresses.push(address);
    }
  }
  return addresses;
}

function exactlyOneIp(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? exactlyOneIp(value[0]) : null;
  }
  if (!value) {
    return null;
  }
  const address = value.trim();
  if (!address || address.includes(',') || /\s/.test(address)) {
    return null;
  }
  return normalizeIp(address);
}

function singleIp(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value[value.length - 1] : value;
  if (!header || header.includes(',')) {
    return null;
  }
  return normalizeIp(header);
}

function normalizeIp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  let address = value.trim().toLowerCase();
  if (!address || address.includes('%')) {
    return null;
  }
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length);
    if (ipv4ToInt(mapped) !== null) {
      return mapped;
    }
  }
  if (ipv4ToInt(address) !== null || isIpv6(address)) {
    return address;
  }
  return null;
}

function matchesCidr(address: string, cidr: string): boolean {
  const [base, prefixText] = cidr.split('/');
  if (!base || cidr.split('/').length > 2) {
    return false;
  }
  if (base.includes(':') || address.includes(':')) {
    return prefixText === undefined && address === base;
  }
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
    return false;
  }
  const addressInt = ipv4ToInt(address);
  const baseInt = ipv4ToInt(base);
  if (addressInt === null || baseInt === null) {
    return false;
  }
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (addressInt & mask) === (baseInt & mask);
}

function isCidr(value: string): boolean {
  const [base, prefixText] = value.split('/');
  if (!base || value.split('/').length > 2) {
    return false;
  }
  if (base.includes(':')) {
    return prefixText === undefined && isIpv6(base);
  }
  if (ipv4ToInt(base) === null) {
    return false;
  }
  if (prefixText === undefined) {
    return true;
  }
  const prefix = Number(prefixText);
  return Number.isInteger(prefix) && prefix >= 1 && prefix <= 32;
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const number = Number(part);
    if (number > 255) {
      return null;
    }
    value = ((value << 8) + number) >>> 0;
  }
  return value;
}

function isIpv6(address: string): boolean {
  if (!address.includes(':') || address.includes(':::')) {
    return false;
  }
  const halves = address.split('::');
  if (halves.length > 2) {
    return false;
  }
  const groups = halves.flatMap((half) => half === '' ? [] : half.split(':'));
  if (groups.length > 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return false;
  }
  return halves.length === 2 || groups.length === 8;
}
