// WhatsApp delivery stays off until WHATSAPP_VERIFICATION_ENABLED=true on the API.
// The apps do not offer SMS or a password as a fallback.

export type AuthEntryActions = {
  smsRegistration: false;
  smsLogin: false;
  passwordLogin: false;
  passwordRecovery: false;
  whatsappRegistration: true;
  whatsappLogin: true;
};

export function authEntryActions(): AuthEntryActions {
  return {
    smsRegistration: false,
    smsLogin: false,
    passwordLogin: false,
    passwordRecovery: false,
    whatsappRegistration: true,
    whatsappLogin: true,
  };
}
