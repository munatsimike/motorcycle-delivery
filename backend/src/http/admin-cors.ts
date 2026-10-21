const METHODS = ['GET', 'POST', 'PUT'] as const;
const ALLOWED_HEADERS = ['Authorization', 'Content-Type', 'Idempotency-Key'] as const;

export type AdminCorsOptions = {
  origin: string;
  methods: readonly ['GET', 'POST', 'PUT'];
  allowedHeaders: readonly ['Authorization', 'Content-Type', 'Idempotency-Key'];
  credentials: false;
};

export function adminWebOrigin(env: NodeJS.ProcessEnv): string | null {
  const raw = env.ADMIN_WEB_ORIGIN?.trim();
  if (!raw || raw === '*') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return null;
  }
  return url.origin;
}

export function adminCorsOptions(env: NodeJS.ProcessEnv): AdminCorsOptions | null {
  const origin = adminWebOrigin(env);
  if (!origin) {
    return null;
  }
  return {
    origin,
    methods: METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: false,
  };
}

export function helmetResourcePolicy(env: NodeJS.ProcessEnv): 'same-origin' | 'cross-origin' {
  return adminWebOrigin(env) ? 'cross-origin' : 'same-origin';
}
