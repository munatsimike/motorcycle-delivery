package com.riders.rider

import com.riders.rider.feature.delivery.data.AssignmentListStore
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.RIDER_CANCELLED_TOAST
import com.riders.rider.feature.delivery.domain.RIDERS_TOAST_DISMISS_MS
import com.riders.rider.feature.delivery.domain.acceptToast
import com.riders.rider.feature.delivery.domain.assignmentsAfterRiderCancellation
import com.riders.rider.feature.delivery.domain.committedAssignmentsForDisplay
import com.riders.rider.feature.delivery.domain.guidanceRemainsOpenAfterCancellation
import com.riders.rider.feature.delivery.domain.riderCancellationLanding
import com.riders.rider.feature.delivery.domain.riderCancellationLeavesScreen
import com.riders.rider.feature.delivery.domain.toastDismissed
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.RiderDestination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderCancellationTest {
    @Test
    fun successfulCancellationDuringCollectionLeavesForActiveDeliveries() {
        assertTrue(v2CancellationVisible("RIDER_ASSIGNED"))
        assertTrue(v2CancellationVisible("COLLECTING"))
        val landing = riderCancellationLanding("assignment-collecting")
        assertTrue(riderCancellationLeavesScreen(succeeded = true))
        assertFalse(guidanceRemainsOpenAfterCancellation(succeeded = true))
        assertEquals(RiderDestination.Deliveries, landing.tab)
        assertEquals(DeliveryBoardTab.Active, landing.board)
        assertEquals(RIDER_CANCELLED_TOAST, landing.toastMessage)
        assertEquals("rider-cancelled:assignment-collecting", landing.eventId)
    }

    @Test
    fun successfulCancellationDuringDeliveryUsesTheSameLanding() {
        assertTrue(v2CancellationVisible("COLLECTED"))
        assertTrue(v2CancellationVisible("OUT_FOR_DELIVERY"))
        val collecting = riderCancellationLanding("assignment-collecting")
        val delivering = riderCancellationLanding("assignment-delivering")
        assertEquals(collecting.tab, delivering.tab)
        assertEquals(collecting.board, delivering.board)
        assertEquals(collecting.toastMessage, delivering.toastMessage)
        assertEquals("rider-cancelled:assignment-delivering", delivering.eventId)
    }

    @Test
    fun cancellationClosesTurnByTurnOnlyAfterSuccess() {
        assertFalse(guidanceRemainsOpenAfterCancellation(succeeded = true))
        assertTrue(guidanceRemainsOpenAfterCancellation(succeeded = false))
        assertFalse(riderCancellationLeavesScreen(succeeded = false))
    }

    @Test
    fun aFailedCancellationStaysOnTheDeliveryAndDoesNotToast() {
        assertFalse(riderCancellationLeavesScreen(succeeded = false))
        assertTrue(guidanceRemainsOpenAfterCancellation(succeeded = false))
        assertNull(acceptToast("", consumedId = null))
    }

    @Test
    fun aFailedAssignmentRefreshKeepsTheCancelledAssignmentOut() {
        val cancelled = parcel("collecting", "assignment-collecting", "COLLECTING")
        val other = parcel("delivering", "assignment-delivering", "OUT_FOR_DELIVERY")
        val remaining = assignmentsAfterRiderCancellation(
            current = listOf(cancelled, other),
            assignmentId = cancelled.assignmentId,
            refreshed = null,
        )
        assertEquals(listOf(other.deliveryId), remaining.map { it.deliveryId })
        assertEquals(listOf(other.deliveryId), committedAssignmentsForDisplay(remaining, "AVAILABLE", true).map { it.deliveryId })
    }

    @Test
    fun aStaleRefreshCannotRestoreTheCancelledAssignment() {
        val store = AssignmentListStore()
        val cancelled = parcel("collecting", "assignment-collecting", "COLLECTING")
        val other = parcel("delivering", "assignment-delivering", "OUT_FOR_DELIVERY")
        store.confirm(store.begin(), listOf(cancelled, other))
        val inflight = store.begin()
        store.removeAssignment(cancelled.assignmentId)
        val kept = store.confirm(inflight, listOf(cancelled, other))
        assertEquals(listOf(other.assignmentId), kept.map { it.assignmentId })
        assertEquals(listOf(other.assignmentId), store.current().map { it.assignmentId })
        assertFalse(store.lastRefreshApplied())
    }

    @Test
    fun theToastIsShownOnceAndDismissesAfterThreeSeconds() {
        val first = acceptToast("rider-cancelled:assignment-collecting", consumedId = null)
        assertEquals("rider-cancelled:assignment-collecting", first)
        assertNull(acceptToast(first!!, consumedId = first))
        assertNull(acceptToast(first, consumedId = first))
        val shownAt = 1_000L
        assertFalse(toastDismissed(shownAt, shownAt + RIDERS_TOAST_DISMISS_MS - 1))
        assertTrue(toastDismissed(shownAt, shownAt + RIDERS_TOAST_DISMISS_MS))
        assertEquals(3_000L, RIDERS_TOAST_DISMISS_MS)
    }

    private fun parcel(deliveryId: String, assignmentId: String, status: String) = CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        serviceClass = "FLEXIBLE",
    )
}
