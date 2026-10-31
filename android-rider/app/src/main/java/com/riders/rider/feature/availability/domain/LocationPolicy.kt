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

const val LOCATION_PERMISSION_REQUIRED = "Location permission is required to go online."

fun shouldRequestAcceptFix(availability: String?, locationIsFresh: Boolean): Boolean {
    return availability == "AVAILABLE" && !locationIsFresh
}

val COMMITTED_DELIVERY_STATUSES: Set<String> = setOf(
    "RIDER_ASSIGNED",
    "COLLECTING",
    "COLLECTED",
    "OUT_FOR_DELIVERY",
    "ASSIGNED",
    "ARRIVED_AT_PICKUP",
    "PICKED_UP",
    "IN_TRANSIT",
    "ARRIVED_AT_DROPOFF",
)

fun hasCommittedAssignment(deliveryStatuses: Collection<String>): Boolean {
    return deliveryStatuses.any { status -> status in COMMITTED_DELIVERY_STATUSES }
}

fun locationStatuses(fetchSucceeded: Boolean, fetched: List<String>, cached: List<String>): List<String> {
    return if (fetchSucceeded) fetched else cached
}

fun locationSharingDecision(
    hasSession: Boolean,
    permissionGranted: Boolean,
    onboardingReached: Boolean,
    receivingRequests: Boolean?,
    availability: String?,
    assignmentFetchSucceeded: Boolean,
    fetchedStatuses: List<String>,
    confirmedStatuses: List<String>,
    confirmedThisProcess: Boolean,
    authoritativeStop: Boolean = false,
): Boolean {
    if (!hasSession || !permissionGranted || authoritativeStop) {
        return false
    }
    val assignmentKnown = assignmentFetchSucceeded || confirmedThisProcess
    if (!onboardingReached && !assignmentKnown) {
        return false
    }
    val statuses = when {
        assignmentFetchSucceeded -> fetchedStatuses
        confirmedThisProcess -> confirmedStatuses
        else -> emptyList()
    }
    return shouldShareLocation(
        hasSession = true,
        permissionGranted = true,
        receivingRequests = receivingRequests,
        deliveryStatuses = statuses,
        availability = availability,
    )
}

fun shouldShareLocation(
    hasSession: Boolean,
    permissionGranted: Boolean,
    receivingRequests: Boolean?,
    deliveryStatuses: Collection<String> = emptyList(),
    availability: String? = null,
): Boolean {
    if (!hasSession || !permissionGranted) {
        return false
    }
    if (availability == "OFFLINE") {
        return hasCommittedAssignment(deliveryStatuses)
    }
    if (receivingRequests == true || hasCommittedAssignment(deliveryStatuses)) {
        return true
    }
    return receivingRequests == null && availability == "AVAILABLE"
}

fun resumeLocationSharing(
    hasSession: Boolean,
    permissionGranted: Boolean,
    serverAvailability: String?,
    receivingRequests: Boolean?,
    deliveryStatuses: Collection<String>,
    locallyEnabled: Boolean,
): Boolean {
    val serverKnown = serverAvailability != null || receivingRequests != null || deliveryStatuses.isNotEmpty()
    if (locallyEnabled && !serverKnown) {
        return false
    }
    return shouldShareLocation(hasSession, permissionGranted, receivingRequests, deliveryStatuses, serverAvailability)
}

enum class LocationCommand {
    KeepSharing,
    Stop,
}

fun commandAfterUploadFailure(error: ApiError): LocationCommand {
    return when (error) {
        ApiError.SessionEnded,
        ApiError.SignedInElsewhere,
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
