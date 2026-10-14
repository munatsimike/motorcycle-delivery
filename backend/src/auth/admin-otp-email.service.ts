import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class AdminOtpEmailService {
  async sendCode(email: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ADMIN_OTP_FROM_EMAIL;

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
    } catch {
      throw new ServiceUnavailableException(
        'Admin email verification is unavailable',
      );
    }
  }
}
