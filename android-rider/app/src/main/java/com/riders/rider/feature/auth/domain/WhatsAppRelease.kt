package com.riders.rider.feature.auth.domain

// WhatsApp delivery stays off until WHATSAPP_VERIFICATION_ENABLED=true on the API.
// The app does not offer SMS or a password as a fallback.

data class AuthEntryActions(
    val smsRegistration: Boolean,
    val smsLogin: Boolean,
    val passwordLogin: Boolean,
    val passwordRecovery: Boolean,
    val whatsappRegistration: Boolean,
    val whatsappLogin: Boolean,
)

fun authEntryActions(): AuthEntryActions {
    return AuthEntryActions(
        smsRegistration = false,
        smsLogin = false,
        passwordLogin = false,
        passwordRecovery = false,
        whatsappRegistration = true,
        whatsappLogin = true,
    )
}
