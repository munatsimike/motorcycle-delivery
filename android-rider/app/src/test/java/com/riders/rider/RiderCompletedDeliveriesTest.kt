package com.riders.rider

import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.CompletedBoard
import com.riders.rider.feature.delivery.domain.applyCompletedBoard
import com.riders.rider.feature.delivery.domain.completedDeliveries
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.parcelRoute
import com.riders.rider.feature.delivery.domain.requestCompletedBoard
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.v2RiderAction
import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.deliveryBoardTabs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderCompletedDeliveriesTest {
    @Test
    fun completedTabSitsBesideActiveAndMyOffers() {
        assertEquals(
            listOf(DeliveryBoardTab.Active, DeliveryBoardTab.Offers, DeliveryBoardTab.Completed),
            deliveryBoardTabs(showsOffers = true),
        )
        assertEquals(
            listOf(DeliveryBoardTab.Active, DeliveryBoardTab.Completed),
            deliveryBoardTabs(showsOffers = false),
        )
    }

    @Test
    fun onlyDeliveredAssignmentsRemainNewestFirst() {
        val shown = completedDeliveries(listOf(
            parcel("active", "RIDER_ASSIGNED", "2026-10-21T08:00:00Z"),
            parcel("cancelled", "CANCELLED", "2026-10-22T08:00:00Z"),
            parcel("failed", "FAILED", "2026-10-22T09:00:00Z"),
            parcel("pending", "SEARCHING", "2026-10-22T10:00:00Z"),
            parcel("older", "DELIVERED", "2026-10-18T08:00:00Z", serviceClass = "FLEXIBLE"),
            parcel("newer", "DELIVERED", "2026-10-20T08:00:00Z"),
        ))
        assertEquals(listOf("newer", "older"), shown.map { it.deliveryId })
        assertEquals("FLEXIBLE", shown[1].serviceClass)
        assertNull(shown[0].serviceClass)
    }

    @Test
    fun aCompletedDeliveryDoesNotExposeProgressActions() {
        assertNull(v2RiderAction("DELIVERED"))
        assertFalse(v2CancellationVisible("DELIVERED"))
        assertNull(navigationTarget("DELIVERED", null, "Pickup road", null, "Drop road", null))
        assertEquals("delivery/delivery-1?completed=true", parcelRoute("delivery-1", completed = true))
        assertEquals("delivery/delivery-1", parcelRoute("delivery-1"))
    }

    @Test
    fun completedHistoryLoadsOnceUntilRefreshAndKeepsAnError() {
        val start = requestCompletedBoard(CompletedBoard(), force = false)
        assertEquals(true, start?.loading)
        assertEquals(false, start?.refreshing)
        val loaded = applyCompletedBoard(start!!, listOf(parcel("done", "DELIVERED", "2026-10-20T08:00:00Z")), null)
        assertEquals(listOf("done"), loaded.deliveries.map { it.deliveryId })
        assertNull(requestCompletedBoard(loaded, force = false))
        val refreshing = requestCompletedBoard(loaded, force = true)
        assertEquals(true, refreshing?.refreshing)
        assertEquals(false, refreshing?.loading)
        val failed = applyCompletedBoard(CompletedBoard(loading = true), null, "Offline")
        assertEquals("Offline", failed.error)
        assertTrue(failed.deliveries.isEmpty())
        val empty = applyCompletedBoard(CompletedBoard(loading = true), emptyList(), null)
        assertTrue(empty.loaded)
        assertTrue(empty.deliveries.isEmpty())
    }

    private fun parcel(
        id: String,
        status: String,
        completedAt: String?,
        serviceClass: String? = null,
    ) = CommittedParcel(
        deliveryId = id,
        assignmentId = "assignment-$id",
        status = status,
        serviceClass = serviceClass,
        completedAt = completedAt,
        parcelDescription = "Documents",
        pickupAddress = "Pickup",
        dropoffAddress = "Drop-off",
    )
}
