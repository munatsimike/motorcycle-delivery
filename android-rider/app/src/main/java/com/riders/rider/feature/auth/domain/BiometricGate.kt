package com.riders.rider.feature.auth.domain

enum class SessionGate {
    SignedOut,
    Restore,
    Biometric,
    BiometricUnavailable,
}

enum class AppEntry {
    SignedOut,
    Unlock,
    Offer,
    Home,
}

data class BiometricSessionState(
    val sawSession: Boolean,
    val unlocked: Boolean,
    val freshSignIn: Boolean,
)

fun sessionGate(
    hasStoredSession: Boolean,
    biometricEnabled: Boolean,
    biometricAvailable: Boolean,
): SessionGate {
    if (!hasStoredSession) {
        return SessionGate.SignedOut
    }
    if (biometricEnabled && biometricAvailable) {
        return SessionGate.Biometric
    }
    if (biometricEnabled) {
        return SessionGate.BiometricUnavailable
    }
    return SessionGate.Restore
}

fun initialBiometricState(hasStoredSession: Boolean): BiometricSessionState {
    return BiometricSessionState(
        sawSession = hasStoredSession,
        unlocked = false,
        freshSignIn = false,
    )
}

fun reduceSession(previous: BiometricSessionState, hasSession: Boolean): BiometricSessionState {
    if (!hasSession) {
        return BiometricSessionState(sawSession = false, unlocked = false, freshSignIn = false)
    }
    if (!previous.sawSession) {
        return BiometricSessionState(sawSession = true, unlocked = true, freshSignIn = true)
    }
    return previous.copy(sawSession = true)
}

fun shouldOfferBiometric(
    freshSignIn: Boolean,
    biometricAvailable: Boolean,
    biometricEnabled: Boolean,
    declined: Boolean,
): Boolean {
    return freshSignIn && biometricAvailable && !biometricEnabled && !declined
}

fun resolveAppEntry(
    hasSession: Boolean,
    biometricEnabled: Boolean,
    biometricAvailable: Boolean,
    unlocked: Boolean,
    freshSignIn: Boolean,
    declined: Boolean,
): AppEntry {
    val gate = sessionGate(hasSession, biometricEnabled, biometricAvailable)
    val offer = shouldOfferBiometric(freshSignIn, biometricAvailable, biometricEnabled, declined)
    return when (gate) {
        SessionGate.SignedOut -> AppEntry.SignedOut
        SessionGate.Biometric -> if (unlocked) AppEntry.Home else AppEntry.Unlock
        SessionGate.BiometricUnavailable -> AppEntry.Unlock
        SessionGate.Restore -> if (offer) AppEntry.Offer else AppEntry.Home
    }
}

fun biometricHomeAction(enabled: Boolean, available: Boolean): String? = when {
    enabled -> "Turn off biometric unlock"
    available -> "Unlock with biometrics"
    else -> null
}
