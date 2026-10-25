import { useEffect, useRef, useState } from 'react';

import { customerAuthRepository } from '../../data/repositories/CustomerAuthApiRepository';
import type { AuthFlow, AuthSession } from '../../domain/auth.types';
import { isVerificationCode } from '../../domain/verificationCode';
import { errorMessage } from '../errorMessage';

const RESEND_COOLDOWN_MS = 60_000;

export type OtpVerificationResult = { flow: 'session'; session: AuthSession };

export function useOtpVerification(phone: string, flow: AuthFlow) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(() => Date.now() + RESEND_COOLDOWN_MS);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsRemaining = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  async function verify(): Promise<OtpVerificationResult | null> {
    if (inFlight.current) {
      return null;
    }
    if (!isVerificationCode(code)) {
      setError('Enter the verification code sent to your phone.');
      return null;
    }

    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const session = flow === 'whatsapp_login'
        ? await customerAuthRepository.verifyWhatsAppLogin(phone, code)
        : await customerAuthRepository.verifyWhatsAppRegistration(phone, code);
      return { flow: 'session', session };
    } catch (caught) {
      setError(errorMessage(caught, 'Verification failed.'));
      return null;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  async function resend(): Promise<void> {
    if (inFlight.current || secondsRemaining > 0) {
      return;
    }
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      if (flow === 'whatsapp_login') {
        await customerAuthRepository.resendWhatsAppLogin(phone);
      } else {
        await customerAuthRepository.resendWhatsAppRegistration(phone);
      }
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
    } catch (caught) {
      setError(errorMessage(caught, 'A new code could not be sent.'));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  return {
    code,
    setCode,
    isLoading,
    error,
    secondsRemaining,
    verify,
    resend,
  };
}
