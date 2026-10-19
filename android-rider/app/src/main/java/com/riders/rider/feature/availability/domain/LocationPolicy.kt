package com.riders.rider.feature.availability.domain

import com.riders.rider.core.network.ApiError

const val LOCATION_FRESH_MS = 60_000L
const val LOCATION_REPORT_INTERVAL_MS = 30_000L
const val LOCATION_MAX_UPDATE_DELAY_MS = 5_000L
const val LOCATION_RETRY_MS = 10_000L
const val LOCATION_MAX_FIX_AGE_MS = 45_000L
const val LOCATION_MAX_ACCURACY_METERS = 500f

enum class LocationPower {
    Balanced,
}

data class LocationUpdatePolicy(
    val intervalMillis: Long = LOCATION_REPORT_INTERVAL_MS,
    val minIntervalMillis: Long = LOCATION_REPORT_INTERVAL_MS,
    val maxUpdateDelayMillis: Long = LOCATION_MAX_UPDATE_DELAY_MS,
    val power: LocationPower = LocationPower.Balanced,
)

fun locationUpdatePolicy(): LocationUpdatePolicy = LocationUpdatePolicy()

fun shouldShareLocation(availability: String?, hasSession: Boolean, permissionGranted: Boolean): Boolean {
    return hasSession && permissionGranted && availability == "AVAILABLE"
}

fun resumeLocationSharing(
    hasSession: Boolean,
    permissionGranted: Boolean,
    serverAvailability: String?,
    locallyEnabled: Boolean,
): Boolean {
    if (locallyEnabled && serverAvailability == null) {
        return false
    }
    return shouldShareLocation(serverAvailability, hasSession, permissionGranted)
}

enum class LocationCommand {
    KeepSharing,
    Stop,
}

fun commandAfterUploadFailure(error: ApiError): LocationCommand {
    return when (error) {
        ApiError.SessionEnded,
        ApiError.Forbidden,
        -> LocationCommand.Stop
        else -> LocationCommand.KeepSharing
    }
}

fun isDispatchUsable(ageMillis: Long, accuracyMeters: Float?): Boolean {
    if (ageMillis < 0L || ageMillis > LOCATION_MAX_FIX_AGE_MS) {
        return false
    }
    if (accuracyMeters == null || accuracyMeters <= 0f) {
        return true
    }
    return accuracyMeters <= LOCATION_MAX_ACCURACY_METERS
}

fun shouldSendUpload(
    nowMillis: Long,
    lastConfirmedAtMillis: Long?,
    lastAttemptAtMillis: Long?,
    lastAttemptSucceeded: Boolean,
): Boolean {
    if (lastConfirmedAtMillis == null && lastAttemptAtMillis == null) {
        return true
    }
    if (!lastAttemptSucceeded) {
        val sinceAttempt = lastAttemptAtMillis?.let { nowMillis - it } ?: Long.MAX_VALUE
        return sinceAttempt >= LOCATION_RETRY_MS
    }
    val sinceConfirm = lastConfirmedAtMillis?.let { nowMillis - it } ?: Long.MAX_VALUE
    return sinceConfirm >= LOCATION_REPORT_INTERVAL_MS - LOCATION_MAX_UPDATE_DELAY_MS
}

fun locationIsFresh(nowMillis: Long, confirmedAtMillis: Long?): Boolean {
    val confirmedAt = confirmedAtMillis ?: return false
    return nowMillis - confirmedAt < LOCATION_FRESH_MS
}
