import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

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

@Injectable()
export class AdminOtpEmailService {
  private readonly logger = new Logger(AdminOtpEmailService.name);

  async sendCode(email: string, code: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const apiKey = env.RESEND_API_KEY;
    const from = env.ADMIN_OTP_FROM_EMAIL;

    if (localAdminOtpFallbackAllowed(env) && (!apiKey || !from)) {
      this.logger.log(`[riders-dev-admin-otp] LOCAL DEVELOPMENT OTP. This code was not emailed.`);
      this.logger.log(`[riders-dev-admin-otp] Email: ${email}`);
      this.logger.log(`[riders-dev-admin-otp] Code: ${code}`);
      return;
    }

    if (!apiKey || !from) {
      throw new ServiceUnavailableException(
        'Admin email verification is unavailable',
      );
    }

    const resend = new Resend(apiKey);

    try {
      const result = await resend.emails.send({
        from,
        to: email,
        subject: 'Riders admin login verification',
        text: `Your Riders admin verification code is ${code}. It expires in 5 minutes. If you did not request this code, ignore this email.`,
      });

      if (result.error || !result.data) {
        throw new Error('Email delivery failed');
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Admin email verification is unavailable',
      );
    }
  }
}

export function localAdminOtpFallbackAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== 'development') {
    return false;
  }
  for (const key of STAGE_ENV_KEYS) {
    const value = env[key]?.toLowerCase() ?? '';
    if (value === 'production' || value === 'staging') {
      return false;
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('RAILWAY_') && value) {
      return false;
    }
  }
  for (const key of HOSTED_ENV_KEYS) {
    if (env[key]) {
      return false;
    }
  }
  if (env.TRUST_RAILWAY_EDGE_CLIENT_IP === 'true') {
    return false;
  }
  return true;
}
