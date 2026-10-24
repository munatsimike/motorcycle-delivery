// Keep this false until Railway WhatsApp verification is enabled.
// SMS registration, SMS login, and password login stay available either way.
export const WHATSAPP_AUTH_ENABLED = false;

export type AuthEntryActions = {
  smsRegistration: true;
  smsLogin: true;
  passwordLogin: true;
  whatsappRegistration: boolean;
  passwordRecovery: boolean;
};

export function authEntryActions(whatsappEnabled = WHATSAPP_AUTH_ENABLED): AuthEntryActions {
  return {
    smsRegistration: true,
    smsLogin: true,
    passwordLogin: true,
    whatsappRegistration: whatsappEnabled,
    passwordRecovery: whatsappEnabled,
  };
}
