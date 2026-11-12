import { HttpException, Logger } from '@nestjs/common';

const logger = new Logger('LicenceStorage');

const SECRET_ENV = [
  'LICENCE_STORAGE_ACCESS_KEY_ID',
  'LICENCE_STORAGE_SECRET_ACCESS_KEY',
  'JWT_SECRET',
  'DATABASE_URL',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'WHATSAPP_VERIFICATION_SERVICE_SID',
  'INFOBIP_API_KEY',
  'INFOBIP_OTP_HMAC_SECRET',
];

export function logStorageFailure(error: unknown, area = 'Licence image'): void {
  const name = error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.name) ? error.name : 'Error';
  const detail = storageDetail(error);
  logger.warn(`${area} storage failed httpStatus=${storageStatus(error)} error=${name}${detail}`);
}

function storageStatus(error: unknown): number | 'none' {
  if (error instanceof HttpException) {
    return error.getStatus();
  }
  if (typeof error === 'object' && error !== null && '$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null && 'httpStatusCode' in error.$metadata && typeof error.$metadata.httpStatusCode === 'number') {
    return error.$metadata.httpStatusCode;
  }
  return 'none';
}

function storageDetail(error: unknown): string {
  if (!(error instanceof Error) || error.message.length === 0) {
    return '';
  }
  let message = error.message;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4) {
      message = message.split(value).join('[redacted]');
    }
  }
  message = message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\+\d{8,15}/g, '[phone]')
    .replace(/\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g, '[redacted]')
    .replace(/riders\/\S+/g, '[object]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180)
    .trim();
  return message.length > 0 ? ` detail=${message}` : '';
}
