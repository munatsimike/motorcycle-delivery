package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ApiError

enum class AssignmentCertainty {
    Unknown,
    Confirmed,
}

enum class DeliveriesPane {
    Recover,
    Committed,
    V1,
}

data class AssignmentRecovery(
    val certainty: AssignmentCertainty,
    val parcels: List<CommittedParcel>,
)

const val ASSIGNMENT_RECOVERY_ATTEMPTS = 3
const val ASSIGNMENT_RECOVERY_DELAY_MS = 5_000L
const val ASSIGNMENT_RECOVERY_MESSAGE = "Your deliveries could not be loaded. Check your connection and try again."

fun recoverAssignments(
    fetchSucceeded: Boolean,
    fetched: List<CommittedParcel>,
    confirmed: List<CommittedParcel>,
    confirmedThisProcess: Boolean,
    failureUncertain: Boolean,
): AssignmentRecovery {
    if (fetchSucceeded) {
        return AssignmentRecovery(AssignmentCertainty.Confirmed, fetched)
    }
    if (confirmedThisProcess && failureUncertain) {
        return AssignmentRecovery(AssignmentCertainty.Confirmed, confirmed)
    }
    return AssignmentRecovery(AssignmentCertainty.Unknown, emptyList())
}

fun deliveriesPane(receiving: Boolean?, recovery: AssignmentRecovery): DeliveriesPane {
    if (recovery.certainty != AssignmentCertainty.Confirmed) {
        return DeliveriesPane.Recover
    }
    if (receiving != null || hasCommittedV2(recovery.parcels.map { parcel -> parcel.serviceClass })) {
        return DeliveriesPane.Committed
    }
    return DeliveriesPane.V1
}

fun parcelActionsAllowed(certainty: AssignmentCertainty): Boolean {
    return certainty == AssignmentCertainty.Confirmed
}

fun assignmentFailureIsUncertain(error: ApiError): Boolean = when (error) {
    ApiError.SessionEnded,
    ApiError.SignedInElsewhere,
    ApiError.Forbidden,
    -> false
    else -> true
}

fun automaticAssignmentRetry(completedAttempts: Int, maxAttempts: Int = ASSIGNMENT_RECOVERY_ATTEMPTS): Boolean {
    return completedAttempts < maxAttempts
}

fun retryWhenConnectivityReturns(refreshPending: Boolean, networkAvailable: Boolean): Boolean {
    return refreshPending && networkAvailable
}
