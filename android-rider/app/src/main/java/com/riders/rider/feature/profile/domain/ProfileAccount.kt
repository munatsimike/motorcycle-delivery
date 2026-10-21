package com.riders.rider.feature.profile.domain

import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding

const val LOGOUT_ALL_OTHER_DEVICES = "This phone was signed out. Other devices may still be signed in."

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

data class LogoutAllFollowUp(
    val clearLocalSession: Boolean,
    val notice: String?,
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

fun logoutAllNotice(confirmed: Boolean, httpCode: Int?): String? {
    if (confirmed) {
        return null
    }
    val prefix = if (httpCode == 401) "Your session has ended. Sign in again. " else ""
    return prefix + LOGOUT_ALL_OTHER_DEVICES
}

fun logoutAllReportsGlobalSuccess(confirmed: Boolean): Boolean = confirmed

fun logoutAllFollowUp(confirmed: Boolean, httpCode: Int?): LogoutAllFollowUp {
    val notice = logoutAllNotice(confirmed, httpCode)
    return LogoutAllFollowUp(clearLocalSession = notice == null, notice = notice)
}

fun acknowledgedLogoutNotice(): LogoutAllFollowUp {
    return LogoutAllFollowUp(clearLocalSession = true, notice = null)
}
