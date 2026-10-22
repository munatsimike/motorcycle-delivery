package com.riders.rider.feature.profile.domain

import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding

data class ProfileBoard(
    val fullName: String = "",
    val phone: String = "",
    val address: String = "",
    val onboarding: RiderOnboarding? = null,
    val hasLicence: Boolean = false,
    val motorcycles: List<MotorcycleDetails> = emptyList(),
    val error: String? = null,
    val loaded: Boolean = false,
)

fun canEditProfileName(): Boolean = false

fun canEditProfilePhone(): Boolean = false

fun showsAccountDeactivation(): Boolean = false

fun shouldLoadProfile(loaded: Boolean, force: Boolean, busy: Boolean): Boolean {
    if (busy) {
        return false
    }
    return force || !loaded
}

fun profileAfterRefresh(
    current: ProfileBoard,
    fullName: String?,
    phone: String?,
    onboarding: RiderOnboarding?,
    hasLicence: Boolean?,
    motorcycles: List<MotorcycleDetails>?,
    error: String?,
    address: String? = null,
): ProfileBoard {
    val loaded = current.loaded || fullName != null || onboarding != null || motorcycles != null
    return current.copy(
        fullName = fullName ?: current.fullName,
        phone = phone ?: current.phone,
        address = address ?: current.address,
        onboarding = onboarding ?: current.onboarding,
        hasLicence = hasLicence ?: current.hasLicence,
        motorcycles = motorcycles ?: current.motorcycles,
        error = error,
        loaded = loaded,
    )
}
