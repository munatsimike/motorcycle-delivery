import { ServiceUnavailableException } from '@nestjs/common';

export const ECOCASH_SANDBOX_ORIGIN = 'https://developers.ecocash.co.zw';
export const ECOCASH_PROVIDER = 'ECOCASH';

const HOSTED_ENV_KEYS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'FLY_APP_NAME',
  'DYNO',
  'K_SERVICE',
  'WEBSITE_SITE_NAME',
  'VERCEL',
  'VERCEL_ENV',
] as const;
const STAGE_ENV_KEYS = ['APP_ENV', 'DEPLOY_ENV', 'ENVIRONMENT', 'STAGE'] as const;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const MERCHANT_CODE = /^[A-Za-z0-9]{1,32}$/;
const MERCHANT_NUMBER = /^[1-9][0-9]{7,14}$/;
const MERCHANT_PIN = /^[0-9]{4,8}$/;
const TERMINAL_ID = /^[A-Za-z0-9]{1,32}$/;

export class EcocashConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcocashConfigurationError';
  }
}

export type EcocashSandboxConfig = {
  enabled: true;
  environment: 'sandbox';
  baseUrl: string;
  username: string;
  password: string;
  merchantCode: string;
  merchantNumber: string;
  merchantPin: string;
  terminalId: string;
  location: string;
  superMerchantName: string;
  merchantName: string;
  purchaseCategoryCode: string;
  chargeDescription: string;
};

export function ecocashEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ECOCASH_ENABLED === 'true';
}

// Automatic crediting is a separate switch from ECOCASH_ENABLED. It stays off
// unless ECOCASH_AUTO_CREDIT_ENABLED is exactly true. Production, staging, and
// hosted environments ignore that value. The switch does not replace provider
// amount and currency evidence.
export function ecocashAutoCreditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ECOCASH_AUTO_CREDIT_ENABLED !== 'true') {
    return false;
  }
  return hostedProblems(env).length === 0;
}

export function assertEcocashConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (!ecocashEnabled(env)) {
    return;
  }
  readEcocashSandboxConfig(env);
}

export function readEcocashSandboxConfig(env: NodeJS.ProcessEnv = process.env): EcocashSandboxConfig {
  if (!ecocashEnabled(env)) {
    throw new ServiceUnavailableException('EcoCash top-up is unavailable');
  }
  const problems = configurationProblems(env);
  if (problems.length > 0) {
    throw new EcocashConfigurationError(`EcoCash sandbox configuration is refused: ${problems.join('; ')}`);
  }
  return {
    enabled: true,
    environment: 'sandbox',
    baseUrl: ECOCASH_SANDBOX_ORIGIN,
    username: required(env.ECOCASH_USERNAME),
    password: required(env.ECOCASH_PASSWORD),
    merchantCode: required(env.ECOCASH_MERCHANT_CODE),
    merchantNumber: required(env.ECOCASH_MERCHANT_NUMBER),
    merchantPin: required(env.ECOCASH_MERCHANT_PIN),
    terminalId: required(env.ECOCASH_TERMINAL_ID),
    location: required(env.ECOCASH_LOCATION),
    superMerchantName: required(env.ECOCASH_SUPER_MERCHANT_NAME),
    merchantName: required(env.ECOCASH_MERCHANT_NAME),
    purchaseCategoryCode: required(env.ECOCASH_PURCHASE_CATEGORY),
    chargeDescription: required(env.ECOCASH_CHARGE_DESCRIPTION),
  };
}

function configurationProblems(env: NodeJS.ProcessEnv): string[] {
  const problems = [...hostedProblems(env)];
  if (env.ECOCASH_ENVIRONMENT !== 'sandbox') {
    problems.push('ECOCASH_ENVIRONMENT must be sandbox');
  }
  if (!sandboxBaseUrl(env.ECOCASH_SANDBOX_BASE_URL)) {
    problems.push('ECOCASH_SANDBOX_BASE_URL must be the documented sandbox origin');
  }
  if (!secret(env.ECOCASH_USERNAME) || required(env.ECOCASH_USERNAME).includes(':')) {
    problems.push('ECOCASH_USERNAME');
  }
  if (!secret(env.ECOCASH_PASSWORD)) {
    problems.push('ECOCASH_PASSWORD');
  }
  if (!MERCHANT_CODE.test(required(env.ECOCASH_MERCHANT_CODE))) {
    problems.push('ECOCASH_MERCHANT_CODE');
  }
  if (!MERCHANT_NUMBER.test(required(env.ECOCASH_MERCHANT_NUMBER))) {
    problems.push('ECOCASH_MERCHANT_NUMBER');
  }
  if (!MERCHANT_PIN.test(required(env.ECOCASH_MERCHANT_PIN))) {
    problems.push('ECOCASH_MERCHANT_PIN');
  }
  if (!TERMINAL_ID.test(required(env.ECOCASH_TERMINAL_ID))) {
    problems.push('ECOCASH_TERMINAL_ID');
  }
  for (const key of [
    'ECOCASH_LOCATION',
    'ECOCASH_SUPER_MERCHANT_NAME',
    'ECOCASH_MERCHANT_NAME',
    'ECOCASH_PURCHASE_CATEGORY',
    'ECOCASH_CHARGE_DESCRIPTION',
  ] as const) {
    if (!TOKEN.test(required(env[key]))) {
      problems.push(key);
    }
  }
  return problems;
}

function hostedProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV !== 'development') {
    problems.push('NODE_ENV must be development');
  }
  for (const key of STAGE_ENV_KEYS) {
    const value = env[key]?.toLowerCase() ?? '';
    if (value === 'production' || value === 'staging') {
      problems.push(`${key} is ${value}`);
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('RAILWAY_') && value) {
      problems.push(key);
    }
  }
  for (const key of HOSTED_ENV_KEYS) {
    if (env[key]) {
      problems.push(key);
    }
  }
  if (env.TRUST_RAILWAY_EDGE_CLIENT_IP === 'true') {
    problems.push('TRUST_RAILWAY_EDGE_CLIENT_IP');
  }
  return problems;
}

function sandboxBaseUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin === ECOCASH_SANDBOX_ORIGIN
    && (url.pathname === '/' || url.pathname === '')
    && url.username === ''
    && url.password === ''
    && url.search === ''
    && url.hash === '';
}

function required(value: string | undefined): string {
  return value?.trim() ?? '';
}

function secret(value: string | undefined): boolean {
  const text = required(value);
  return text.length >= 8 && !/[\r\n]/.test(text) && !text.startsWith('replace-with-');
}
