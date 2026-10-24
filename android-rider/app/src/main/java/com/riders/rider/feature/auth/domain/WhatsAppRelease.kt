package com.riders.rider.feature.auth.domain

// Keep this false until Railway WhatsApp verification is enabled.
// SMS registration, SMS login, and password login stay available either way.
object WhatsAppRelease {
    const val ENABLED = false
}

data class AuthEntryActions(
    val smsRegistration: Boolean,
    val smsLogin: Boolean,
    val passwordLogin: Boolean,
    val whatsappRegistration: Boolean,
    val passwordRecovery: Boolean,
)

fun authEntryActions(whatsappEnabled: Boolean = WhatsAppRelease.ENABLED): AuthEntryActions {
    return AuthEntryActions(
        smsRegistration = true,
        smsLogin = true,
        passwordLogin = true,
        whatsappRegistration = whatsappEnabled,
        passwordRecovery = whatsappEnabled,
    )
}
