export function resolveApiBaseUrl(input: {
  configured: string | undefined;
  dev: boolean;
  platform: string;
}): string {
  const configured = input.configured?.trim().replace(/\/$/, '') ?? '';
  if (!configured) {
    throw new Error('The app is missing its API address.');
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('The app has an invalid API address.');
  }
  if (url.username || url.password || !url.hostname) {
    throw new Error('The app has an invalid API address.');
  }
  if (url.protocol === 'https:') {
    return configured;
  }
  if (url.protocol === 'http:' && input.dev && input.platform === 'android' && isLocalNetworkHost(url.hostname)) {
    return configured;
  }
  if (url.protocol === 'http:') {
    throw new Error('The app requires an https API address.');
  }
  throw new Error('The app has an invalid API address.');
}

function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') {
    return true;
  }
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = numbers;
  if (first === 127 || first === 10 || (first === 192 && second === 168)) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
}
