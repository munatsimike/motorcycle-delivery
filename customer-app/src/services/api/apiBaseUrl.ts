export function resolveApiBaseUrl(input: {
  configured: string | undefined;
  dev: boolean;
  platform: string;
  emulator?: boolean;
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
    if (input.emulator && isLoopbackHost(url.hostname)) {
      return withHostname(url, '10.0.2.2');
    }
    return configured;
  }
  if (url.protocol === 'http:') {
    throw new Error('The app requires an https API address.');
  }
  throw new Error('The app has an invalid API address.');
}

function withHostname(url: URL, hostname: string): string {
  const port = url.port ? `:${url.port}` : '';
  const path = `${url.pathname}${url.search}`;
  const suffix = path === '/' ? '' : path;
  return `${url.protocol}//${hostname}${port}${suffix}`;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function looksLikeAndroidEmulator(input: {
  fingerprint?: string;
  model?: string;
  hardware?: string;
  product?: string;
  manufacturer?: string;
}): boolean {
  const fingerprint = input.fingerprint?.toLowerCase() ?? '';
  const hardware = input.hardware?.toLowerCase() ?? '';
  const product = input.product?.toLowerCase() ?? '';
  const model = input.model ?? '';
  return fingerprint.startsWith('generic')
    || fingerprint.includes('emulator')
    || fingerprint.includes('sdk_gphone')
    || model.includes('Emulator')
    || model.includes('Android SDK built for')
    || hardware.includes('goldfish')
    || hardware.includes('ranchu')
    || product.includes('sdk_gphone')
    || product === 'google_sdk'
    || (input.manufacturer?.toLowerCase().includes('genymotion') ?? false);
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
