package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ApiError
import kotlinx.serialization.Serializable

const val DELIVERY_COMPLETED = "Delivery completed!"
const val IDEMPOTENCY_CONFLICT_MESSAGE = "This idempotency key was already used"

val V2CancellationReasons = listOf(
    "PAYMENT_NOT_AGREED" to "Payment was not agreed",
    "PARCEL_NOT_AS_DESCRIBED" to "Parcel was not as described",
    "PARCEL_TOO_LARGE" to "Parcel is too large",
    "SENDER_UNAVAILABLE" to "Sender was unavailable",
    "WRONG_ADDRESS" to "Wrong address",
    "BREAKDOWN" to "Breakdown",
    "OTHER" to "Other",
)

@Serializable
data class TransitionAttempt(
    val deliveryId: String,
    val targetStatus: String,
    val key: String,
)

@Serializable
data class CancellationAttempt(
    val assignmentId: String,
    val reason: String,
    val note: String?,
    val key: String,
)

fun progressAttempt(
    existing: TransitionAttempt?,
    deliveryId: String,
    targetStatus: String,
    newKey: String,
): TransitionAttempt {
    if (existing?.deliveryId == deliveryId && !v2StoredTargetSkipsAhead(existing.targetStatus, targetStatus)) {
        return existing
    }
    return TransitionAttempt(deliveryId, targetStatus, newKey)
}

private fun v2StoredTargetSkipsAhead(storedTarget: String, requestedTarget: String): Boolean {
    if (storedTarget == requestedTarget) {
        return false
    }
    val stored = V2DeliveryProgress.indexOf(storedTarget)
    val requested = V2DeliveryProgress.indexOf(requestedTarget)
    if (stored < 0 || requested < 0) {
        return true
    }
    return stored > requested
}

fun progressAttemptAfterRefresh(existing: TransitionAttempt?, serverStatus: String?): TransitionAttempt? {
    if (existing == null || serverStatus == null) {
        return existing
    }
    return if (v2StatusReached(serverStatus, existing.targetStatus)) null else existing
}

fun cancellationAttempt(
    existing: CancellationAttempt?,
    assignmentId: String,
    reason: String,
    note: String?,
    newKey: String,
): CancellationAttempt {
    if (existing?.assignmentId == assignmentId) {
        return existing
    }
    return CancellationAttempt(assignmentId, reason, note, newKey)
}

fun cancellationResultMessage(reopened: Boolean): String {
    return if (reopened) {
        "This delivery was cancelled. The request was reopened."
    } else {
        "This delivery was cancelled. The request was closed."
    }
}

fun cancellationNoteError(reason: String, note: String): String? {
    if (reason == "OTHER" && note.trim().isEmpty()) {
        return "Enter a cancellation note"
    }
    return null
}

fun isIdempotencyConflict(error: ApiError): Boolean {
    return error is ApiError.Conflict && error.message == IDEMPOTENCY_CONFLICT_MESSAGE
}

fun updateParcelStatus(assignments: List<CommittedParcel>, deliveryId: String, status: String): List<CommittedParcel> {
    return assignments.map { parcel ->
        if (parcel.deliveryId == deliveryId) parcel.copy(status = status) else parcel
    }
}

fun targetForParcel(serverStatus: String, pending: TransitionAttempt?, deliveryId: String): String? {
    if (pending != null && pending.deliveryId == deliveryId && !v2StatusReached(serverStatus, pending.targetStatus)) {
        return pending.targetStatus
    }
    return v2NextStatus(serverStatus)
}
