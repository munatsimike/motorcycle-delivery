package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.delivery.domain.CancellationAttempt
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.TransitionAttempt
import com.riders.rider.feature.delivery.domain.cancellationAttempt
import com.riders.rider.feature.delivery.domain.cancellationNoteError
import com.riders.rider.feature.delivery.domain.cancellationResultMessage
import com.riders.rider.feature.delivery.domain.isIdempotencyConflict
import com.riders.rider.feature.delivery.domain.progressAttempt
import com.riders.rider.feature.delivery.domain.progressAttemptAfterRefresh
import com.riders.rider.feature.delivery.domain.targetForParcel
import com.riders.rider.feature.delivery.domain.updateParcelStatus
import com.riders.rider.feature.delivery.domain.navigationActionLabel
import com.riders.rider.feature.delivery.domain.v2ActionLabel
import com.riders.rider.feature.delivery.domain.v2RiderAction
import com.riders.rider.feature.delivery.domain.v2TapTarget
import com.riders.rider.feature.delivery.domain.riderCancelReasonChoices
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.ASSIGNMENT_RECOVERY_MESSAGE
import com.riders.rider.feature.delivery.domain.DELIVERY_STATUS_UNAVAILABLE
import com.riders.rider.feature.delivery.domain.blockedDeliveryConfirmationMessage
import com.riders.rider.feature.delivery.domain.deliveryActionLoadingLabel
import com.riders.rider.feature.delivery.domain.v2NextStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderParcelProgressTest {
    @Test
    fun v2ProgressShowsOneActionAndStopsAtDelivered() {
        assertEquals("COLLECTED", v2NextStatus("RIDER_ASSIGNED"))
        assertEquals("Confirm pickup", v2RiderAction("RIDER_ASSIGNED"))
        assertEquals("Confirming", deliveryActionLoadingLabel("Confirm pickup"))
        assertEquals("Completing", deliveryActionLoadingLabel("Mark as delivered"))
        assertEquals("DELIVERED", v2TapTarget("COLLECTED"))
        assertEquals("DELIVERED", v2TapTarget("OUT_FOR_DELIVERY", "COLLECTED"))
        assertEquals(
            ASSIGNMENT_RECOVERY_MESSAGE,
            blockedDeliveryConfirmationMessage(
                marketplaceParcel = true,
                assignmentsConfirmed = false,
                syncing = false,
                busy = false,
                completed = false,
            ),
        )
        assertEquals(
            ASSIGNMENT_RECOVERY_MESSAGE,
            blockedDeliveryConfirmationMessage(
                marketplaceParcel = true,
                assignmentsConfirmed = true,
                syncing = true,
                busy = false,
                completed = false,
            ),
        )
        assertNull(
            blockedDeliveryConfirmationMessage(
                marketplaceParcel = true,
                assignmentsConfirmed = true,
                syncing = false,
                busy = true,
                completed = false,
            ),
        )
        assertNull(
            blockedDeliveryConfirmationMessage(
                marketplaceParcel = true,
                assignmentsConfirmed = true,
                syncing = false,
                busy = false,
                completed = true,
            ),
        )
        assertEquals(DELIVERY_STATUS_UNAVAILABLE, "This delivery status cannot be changed")
        assertNull(v2ActionLabel("COLLECTING"))
        assertEquals("COLLECTED", v2NextStatus("COLLECTING"))
        assertEquals("Confirm pickup", v2RiderAction("COLLECTING"))
        assertEquals("Confirm pickup", v2ActionLabel("COLLECTED"))
        assertNull(v2ActionLabel("OUT_FOR_DELIVERY"))
        assertEquals("DELIVERED", v2NextStatus("COLLECTED"))
        assertEquals("Mark as delivered", v2RiderAction("COLLECTED"))
        assertEquals("DELIVERED", v2NextStatus("OUT_FOR_DELIVERY"))
        assertEquals("Mark as delivered", v2RiderAction("OUT_FOR_DELIVERY"))
        assertEquals("Mark as delivered", v2ActionLabel("DELIVERED"))
        assertNull(v2NextStatus("DELIVERED"))
        assertNull(v2RiderAction("DELIVERED"))
        assertNull(v2ActionLabel("RIDER_ASSIGNED"))
        assertEquals("Navigate to pickup", navigationActionLabel("RIDER_ASSIGNED"))
        assertEquals("Navigate to drop-off", navigationActionLabel("COLLECTED"))
        assertEquals("Navigate to drop-off", navigationActionLabel("OUT_FOR_DELIVERY"))
        assertEquals(listOf("COLLECTED"), tapTargets("RIDER_ASSIGNED"))
        assertEquals(listOf("COLLECTED"), tapTargets("COLLECTING"))
        assertEquals(listOf("DELIVERED"), tapTargets("COLLECTED"))
        assertEquals(listOf("DELIVERED"), tapTargets("OUT_FOR_DELIVERY"))
        assertEquals("DELIVERED", v2TapTarget("COLLECTED", "OUT_FOR_DELIVERY"))
        assertEquals(emptyList<String>(), tapTargets("DELIVERED"))
    }

    @Test
    fun cancellationStaysAvailableUntilTheParcelIsDelivered() {
        assertTrue(v2CancellationVisible("RIDER_ASSIGNED"))
        assertTrue(v2CancellationVisible("COLLECTING"))
        assertTrue(v2CancellationVisible("COLLECTED"))
        assertTrue(v2CancellationVisible("OUT_FOR_DELIVERY"))
        assertFalse(v2CancellationVisible("DELIVERED"))
        assertEquals("Enter a cancellation note", cancellationNoteError("OTHER", " "))
        assertNull(cancellationNoteError("BREAKDOWN", ""))
        assertEquals(
            listOf(
                "PAYMENT_NOT_AGREED",
                "PARCEL_NOT_AS_DESCRIBED",
                "PARCEL_TOO_LARGE",
                "SENDER_UNAVAILABLE",
                "WRONG_ADDRESS",
                "BREAKDOWN",
            ),
            riderCancelReasonChoices().map { it.first },
        )
        assertEquals("Payment was not agreed", riderCancelReasonChoices().first().second)
        assertEquals("Breakdown", riderCancelReasonChoices().last().second)
    }

    @Test
    fun startingOneParcelLeavesItsSiblingUnchanged() {
        val assignments = listOf(
            parcel("flex-a", "RIDER_ASSIGNED"),
            parcel("flex-b", "RIDER_ASSIGNED"),
            parcel("express-1", "COLLECTING"),
        )
        val updated = updateParcelStatus(assignments, "flex-a", "COLLECTED")
        assertEquals("COLLECTED", updated[0].status)
        assertEquals("RIDER_ASSIGNED", updated[1].status)
        assertEquals("COLLECTING", updated[2].status)
        assertEquals("flex-b", updated[1].deliveryId)
    }

    @Test
    fun anUncertainProgressRetryKeepsTheSameKeyAndTarget() {
        val first = progressAttempt(null, "flex-a", "COLLECTED", "key-1")
        val retry = progressAttempt(first, "flex-a", "COLLECTED", "key-2")
        val replaced = progressAttempt(TransitionAttempt("flex-a", "COLLECTING", "key-old"), "flex-a", "COLLECTED", "key-3")
        assertEquals("key-1", retry.key)
        assertEquals("COLLECTED", replaced.targetStatus)
        assertEquals("key-3", replaced.key)
        assertEquals("COLLECTED", targetForParcel("RIDER_ASSIGNED", first, "flex-a"))
        val afterTimeout = progressAttemptAfterRefresh(first, "RIDER_ASSIGNED")
        assertEquals(first, afterTimeout)
        val ahead = TransitionAttempt("flex-a", "OUT_FOR_DELIVERY", "key-ahead")
        val held = progressAttempt(ahead, "flex-a", "COLLECTED", "key-next")
        val delivered = progressAttempt(ahead, "flex-a", "DELIVERED", "key-done")
        assertEquals("COLLECTED", held.targetStatus)
        assertEquals("key-next", held.key)
        assertEquals("DELIVERED", delivered.targetStatus)
        assertEquals("key-done", delivered.key)
        val collectedKey = TransitionAttempt("flex-a", "COLLECTED", "key-collected")
        val completion = progressAttempt(collectedKey, "flex-a", "DELIVERED", "key-delivered")
        assertEquals("DELIVERED", completion.targetStatus)
        assertEquals("key-delivered", completion.key)
        assertEquals("key-collected", progressAttempt(collectedKey, "flex-a", "COLLECTED", "key-new").key)
        assertEquals("COLLECTED", v2TapTarget("RIDER_ASSIGNED", "OUT_FOR_DELIVERY"))
    }

    @Test
    fun aConfirmedStatusClearsThePendingTransitionAndDoesNotSkipAhead() {
        val pending = TransitionAttempt("flex-a", "COLLECTED", "key-1")
        assertNull(progressAttemptAfterRefresh(pending, "COLLECTED"))
        assertEquals("COLLECTED", targetForParcel("COLLECTING", null, "flex-a"))
        val next = progressAttempt(null, "flex-a", "COLLECTED", "key-2")
        assertEquals("key-2", next.key)
        assertEquals("COLLECTED", next.targetStatus)
    }

    @Test
    fun anIdempotencyConflictKeepsTheAttemptUntilTheServerShowsItCommitted() {
        val pending = TransitionAttempt("flex-a", "COLLECTED", "key-1")
        assertTrue(isIdempotencyConflict(ApiError.Conflict("This idempotency key was already used")))
        assertFalse(isIdempotencyConflict(ApiError.Conflict("This delivery status cannot be changed")))
        assertEquals(pending, progressAttemptAfterRefresh(pending, "RIDER_ASSIGNED"))
        assertEquals(pending, progressAttemptAfterRefresh(pending, "COLLECTING"))
        assertNull(progressAttemptAfterRefresh(pending, "COLLECTED"))
    }

    @Test
    fun cancellationRetriesTheSameReasonAndReportsTheServerResult() {
        val first = cancellationAttempt(null, "assignment-a", "BREAKDOWN", null, "cancel-1")
        val retry = cancellationAttempt(first, "assignment-a", "OTHER", "Changed", "cancel-2")
        assertEquals("cancel-1", retry.key)
        assertEquals("BREAKDOWN", retry.reason)
        assertNull(retry.note)
        assertEquals("This delivery was cancelled.", cancellationResultMessage(reopened = true))
        assertEquals("This delivery was cancelled.", cancellationResultMessage(reopened = false))
        val sibling = CancellationAttempt("assignment-b", "BREAKDOWN", null, "cancel-1")
        assertEquals("assignment-b", sibling.assignmentId)
        assertEquals("assignment-a", first.assignmentId)
    }

    private fun tapTargets(current: String): List<String> {
        val next = v2TapTarget(current) ?: return emptyList()
        return listOf(next)
    }

    private fun parcel(deliveryId: String, status: String) = CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = "assignment-$deliveryId",
        status = status,
        serviceClass = if (deliveryId.startsWith("express")) "EXPRESS" else "FLEXIBLE",
    )
}
