package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.delivery.domain.CancellationAttempt
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.TransitionAttempt
import com.riders.rider.feature.delivery.domain.cancellationAttempt
import com.riders.rider.feature.delivery.domain.cancellationNoteError
import com.riders.rider.feature.delivery.domain.cancellationResultMessage
import com.riders.rider.feature.delivery.domain.deliveryActionLabel
import com.riders.rider.feature.delivery.domain.isIdempotencyConflict
import com.riders.rider.feature.delivery.domain.nextDeliveryStatus
import com.riders.rider.feature.delivery.domain.progressAttempt
import com.riders.rider.feature.delivery.domain.progressAttemptAfterRefresh
import com.riders.rider.feature.delivery.domain.targetForParcel
import com.riders.rider.feature.delivery.domain.updateParcelStatus
import com.riders.rider.feature.delivery.domain.v2ActionLabel
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.v2NextStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderParcelProgressTest {
    @Test
    fun v2ProgressShowsOneActionAndStopsAtDelivered() {
        assertEquals("COLLECTING", v2NextStatus("RIDER_ASSIGNED"))
        assertEquals("Start Collecting", v2ActionLabel("COLLECTING"))
        assertEquals("COLLECTED", v2NextStatus("COLLECTING"))
        assertEquals("Confirm Collected", v2ActionLabel("COLLECTED"))
        assertEquals("OUT_FOR_DELIVERY", v2NextStatus("COLLECTED"))
        assertEquals("Out for Delivery", v2ActionLabel("OUT_FOR_DELIVERY"))
        assertEquals("DELIVERED", v2NextStatus("OUT_FOR_DELIVERY"))
        assertEquals("Confirm Delivered", v2ActionLabel("DELIVERED"))
        assertNull(v2NextStatus("DELIVERED"))
        assertNull(v2ActionLabel("RIDER_ASSIGNED"))
    }

    @Test
    fun cancellationIsAvailableOnlyBeforeCollection() {
        assertTrue(v2CancellationVisible("RIDER_ASSIGNED"))
        assertTrue(v2CancellationVisible("COLLECTING"))
        assertFalse(v2CancellationVisible("COLLECTED"))
        assertFalse(v2CancellationVisible("OUT_FOR_DELIVERY"))
        assertFalse(v2CancellationVisible("DELIVERED"))
        assertEquals("Enter a cancellation note", cancellationNoteError("OTHER", " "))
        assertNull(cancellationNoteError("BREAKDOWN", ""))
    }

    @Test
    fun startingOneParcelLeavesItsSiblingUnchanged() {
        val assignments = listOf(
            parcel("flex-a", "RIDER_ASSIGNED"),
            parcel("flex-b", "RIDER_ASSIGNED"),
            parcel("express-1", "COLLECTING"),
        )
        val updated = updateParcelStatus(assignments, "flex-a", "COLLECTING")
        assertEquals("COLLECTING", updated[0].status)
        assertEquals("RIDER_ASSIGNED", updated[1].status)
        assertEquals("COLLECTING", updated[2].status)
        assertEquals("flex-b", updated[1].deliveryId)
    }

    @Test
    fun anUncertainProgressRetryKeepsTheSameKeyAndTarget() {
        val first = progressAttempt(null, "flex-a", "COLLECTING", "key-1")
        val retry = progressAttempt(first, "flex-a", "COLLECTING", "key-2")
        val skipped = progressAttempt(first, "flex-a", "COLLECTED", "key-3")
        assertEquals("key-1", retry.key)
        assertEquals("COLLECTING", skipped.targetStatus)
        assertEquals("COLLECTING", targetForParcel("RIDER_ASSIGNED", first, "flex-a"))
        val afterTimeout = progressAttemptAfterRefresh(first, "RIDER_ASSIGNED")
        assertEquals(first, afterTimeout)
    }

    @Test
    fun aConfirmedStatusClearsThePendingTransitionAndDoesNotSkipAhead() {
        val pending = TransitionAttempt("flex-a", "COLLECTING", "key-1")
        assertNull(progressAttemptAfterRefresh(pending, "COLLECTING"))
        assertEquals("COLLECTED", targetForParcel("COLLECTING", null, "flex-a"))
        val next = progressAttempt(null, "flex-a", "COLLECTED", "key-2")
        assertEquals("key-2", next.key)
        assertEquals("COLLECTED", next.targetStatus)
    }

    @Test
    fun anIdempotencyConflictKeepsTheAttemptUntilTheServerShowsItCommitted() {
        val pending = TransitionAttempt("flex-a", "COLLECTING", "key-1")
        assertTrue(isIdempotencyConflict(ApiError.Conflict("This idempotency key was already used")))
        assertFalse(isIdempotencyConflict(ApiError.Conflict("This delivery status cannot be changed")))
        assertEquals(pending, progressAttemptAfterRefresh(pending, "RIDER_ASSIGNED"))
        assertNull(progressAttemptAfterRefresh(pending, "COLLECTING"))
    }

    @Test
    fun cancellationRetriesTheSameReasonAndReportsTheServerResult() {
        val first = cancellationAttempt(null, "assignment-a", "BREAKDOWN", null, "cancel-1")
        val retry = cancellationAttempt(first, "assignment-a", "OTHER", "Changed", "cancel-2")
        assertEquals("cancel-1", retry.key)
        assertEquals("BREAKDOWN", retry.reason)
        assertNull(retry.note)
        assertEquals("This delivery was cancelled. The request was reopened.", cancellationResultMessage(reopened = true))
        assertEquals("This delivery was cancelled. The request was closed.", cancellationResultMessage(reopened = false))
        val sibling = CancellationAttempt("assignment-b", "BREAKDOWN", null, "cancel-1")
        assertEquals("assignment-b", sibling.assignmentId)
        assertEquals("assignment-a", first.assignmentId)
    }

    @Test
    fun theV1ChainStillReachesDelivered() {
        assertEquals("ARRIVED_AT_PICKUP", nextDeliveryStatus("ASSIGNED"))
        assertEquals("PICKED_UP", nextDeliveryStatus("ARRIVED_AT_PICKUP"))
        assertEquals("IN_TRANSIT", nextDeliveryStatus("PICKED_UP"))
        assertEquals("ARRIVED_AT_DROPOFF", nextDeliveryStatus("IN_TRANSIT"))
        assertEquals("DELIVERED", nextDeliveryStatus("ARRIVED_AT_DROPOFF"))
        assertNull(nextDeliveryStatus("DELIVERED"))
        assertEquals("Arrived at pickup", deliveryActionLabel("ASSIGNED"))
        assertEquals("Confirm delivery", deliveryActionLabel("ARRIVED_AT_DROPOFF"))
    }

    private fun parcel(deliveryId: String, status: String) = CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = "assignment-$deliveryId",
        status = status,
        serviceClass = if (deliveryId.startsWith("express")) "EXPRESS" else "FLEXIBLE",
    )
}
