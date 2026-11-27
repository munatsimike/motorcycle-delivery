package com.riders.rider

import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.CompletedBoard
import com.riders.rider.feature.delivery.domain.applyCompletedBoard
import com.riders.rider.feature.delivery.domain.HISTORY_CACHE_LIMIT
import com.riders.rider.feature.delivery.domain.HistoryStatus
import com.riders.rider.feature.delivery.domain.completedDeliveries
import com.riders.rider.feature.delivery.domain.HISTORY_CUSTOMER_CANCELLATION
import com.riders.rider.feature.delivery.domain.HISTORY_RIDER_CANCELLATION
import com.riders.rider.feature.delivery.domain.historyCache
import com.riders.rider.feature.delivery.domain.historyCancellationCopy
import com.riders.rider.feature.delivery.domain.historyDeliveries
import com.riders.rider.feature.delivery.domain.historyFetchApplies
import com.riders.rider.feature.delivery.domain.historyRecord
import com.riders.rider.feature.delivery.domain.historySortTime
import com.riders.rider.feature.delivery.domain.historyStopLines
import com.riders.rider.feature.delivery.domain.invalidatesHistory
import com.riders.rider.feature.delivery.domain.showsDeliveredConfirmation
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.parcelRoute
import com.riders.rider.feature.delivery.domain.requestCompletedBoard
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.v2RiderAction
import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.defaultDeliveryBoardTab
import com.riders.rider.navigation.deliveryBoardTabLabel
import com.riders.rider.navigation.deliveryBoardTab
import com.riders.rider.navigation.deliveryBoardTabs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderCompletedDeliveriesTest {
    @Test
    fun deliveriesScreenUsesThreeTabsWithActiveFirst() {
        val tabs = listOf(
            DeliveryBoardTab.Active,
            DeliveryBoardTab.Pending,
            DeliveryBoardTab.Completed,
        )
        assertEquals(tabs, deliveryBoardTabs(showsOffers = true))
        assertEquals(tabs, deliveryBoardTabs(showsOffers = false))
        assertEquals(3, tabs.size)
        assertFalse(tabs.contains(DeliveryBoardTab.New))
        assertEquals(DeliveryBoardTab.Active, defaultDeliveryBoardTab())
        assertEquals(DeliveryBoardTab.Active, deliveryBoardTab("New"))
        assertEquals(DeliveryBoardTab.Active, deliveryBoardTab(null))
        assertEquals(DeliveryBoardTab.Active, deliveryBoardTab(" "))
        assertEquals(DeliveryBoardTab.Active, deliveryBoardTab("Unknown"))
        assertEquals(DeliveryBoardTab.Pending, deliveryBoardTab("Pending"))
        assertEquals(DeliveryBoardTab.Completed, deliveryBoardTab("Completed"))
        assertEquals(listOf("Active", "Pending", "History"), tabs.map(::deliveryBoardTabLabel))
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
        assertNull(v2RiderAction("CANCELLED"))
        assertFalse(v2CancellationVisible("DELIVERED"))
        assertFalse(v2CancellationVisible("CANCELLED"))
        assertNull(navigationTarget("DELIVERED", null, "Pickup road", null, "Drop road", null))
        assertEquals("delivery/delivery-1?completed=true", parcelRoute("delivery-1", completed = true))
        assertEquals("delivery/delivery-1", parcelRoute("delivery-1"))
        assertEquals("delivery/delivery-1", parcelRoute("delivery-1", assignmentId = "assignment-1"))
        assertEquals(
            "delivery/delivery-1?completed=true&assignment=assignment-1",
            parcelRoute("delivery-1", completed = true, assignmentId = "assignment-1"),
        )
    }

    @Test
    fun completedHistoryLoadsOnceUntilRefreshAndKeepsAnError() {
        val start = requestCompletedBoard(CompletedBoard(), force = false)
        assertEquals(true, start?.loading)
        assertEquals(false, start?.refreshing)
        val loaded = applyCompletedBoard(start!!, listOf(parcel("done", "DELIVERED", "2026-10-20T08:00:00Z")), null)
        assertEquals(listOf("done"), loaded.deliveries.map { it.deliveryId })
        assertNull(requestCompletedBoard(loaded, force = false))
        val automatic = requestCompletedBoard(loaded, force = true)!!
        assertFalse(automatic.refreshing)
        assertFalse(automatic.loading)
        assertTrue(automatic.syncing)
        val refreshing = requestCompletedBoard(loaded, force = true, fromUser = true)!!
        assertTrue(refreshing.refreshing)
        assertFalse(refreshing.loading)
        assertTrue(refreshing.syncing)
        assertFalse(applyCompletedBoard(refreshing, loaded.deliveries, null).syncing)
        assertFalse(applyCompletedBoard(refreshing, null, "Offline").syncing)
        val failed = applyCompletedBoard(CompletedBoard(loading = true), null, "Offline")
        assertEquals("Offline", failed.error)
        assertTrue(failed.deliveries.isEmpty())
        val empty = applyCompletedBoard(CompletedBoard(loading = true), emptyList(), null)
        assertTrue(empty.loaded)
        assertTrue(empty.deliveries.isEmpty())
        val emptyAuto = requestCompletedBoard(empty, force = true)!!
        assertFalse(emptyAuto.refreshing)
        assertFalse(emptyAuto.loading)
        assertTrue(emptyAuto.syncing)
        val emptyManual = requestCompletedBoard(empty, force = true, fromUser = true)!!
        assertTrue(emptyManual.refreshing)
        assertFalse(emptyManual.loading)
    }

    @Test
    fun historyKeepsDeliveredAndCancelledAndCachesFive() {
        val mixed = (1..6).map { index ->
            parcel(
                "delivery-$index",
                if (index % 2 == 0) "CANCELLED" else "DELIVERED",
                "2026-10-1${index}T08:00:00Z",
            ).copy(
                cancelledAt = if (index % 2 == 0) "2026-10-2${index}T08:00:00Z" else null,
                cancelledBy = if (index % 2 == 0) "Customer" else null,
            )
        }
        val shown = historyDeliveries(mixed + parcel("live", "RIDER_ASSIGNED", null))
        assertEquals(6, shown.size)
        assertEquals(HISTORY_CACHE_LIMIT, historyCache(shown).size)
        assertTrue(historyCache(shown).any { it.status == "DELIVERED" })
        assertTrue(historyCache(shown).any { it.status == "CANCELLED" })
        assertEquals(HistoryStatus.All, CompletedBoard().historyStatus)
        val board = applyCompletedBoard(CompletedBoard(historyStatus = HistoryStatus.Cancelled), shown, null)
        assertEquals(HistoryStatus.Cancelled, board.historyStatus)
        assertEquals(6, board.deliveries.size)
        val appended = com.riders.rider.feature.delivery.domain.appendCompletedPage(board, listOf(parcel("again", "CANCELLED", null)), null)
        assertTrue(appended.deliveries.any { it.deliveryId == "again" && it.status == "CANCELLED" })
    }

    @Test
    fun cancelledHistoryKeepsBothAddressesAndSkipsDeliveredConfirmation() {
        assertTrue(showsDeliveredConfirmation("DELIVERED"))
        assertFalse(showsDeliveredConfirmation("CANCELLED"))
        assertEquals("Pickup" to "", historyStopLines("DELIVERED", "Pickup", "Drop-off"))
        assertEquals("Pickup" to "Drop-off", historyStopLines("CANCELLED", "Pickup", "Drop-off"))
    }

    @Test
    fun historyLookupUsesAssignmentIdAndDeepLinksStayOnDeliveryId() {
        val delivered = parcel("shared", "DELIVERED", "2026-10-21T08:00:00Z").copy(assignmentId = "completed-assignment")
        val cancelled = parcel("shared", "CANCELLED", "2026-10-19T08:00:00Z").copy(
            assignmentId = "released-assignment",
            cancelledAt = "2026-10-19T08:00:00Z",
        )
        val records = listOf(delivered, cancelled)
        assertEquals("released-assignment", historyRecord(records, "released-assignment", "shared")?.assignmentId)
        assertEquals("CANCELLED", historyRecord(records, "released-assignment", "shared")?.status)
        assertEquals("completed-assignment", historyRecord(records, null, "shared")?.assignmentId)
        assertEquals("completed-assignment", historyRecord(records, "  ", "shared")?.assignmentId)
        assertEquals("2026-10-19T08:00:00Z", historySortTime(cancelled.copy(completedAt = "2026-10-22T08:00:00Z")))
        assertEquals("2026-10-21T08:00:00Z", historySortTime(delivered))
    }

    @Test
    fun historyRefreshRejectsAStalePageAndCancellationMakesHistoryStale() {
        assertTrue(historyFetchApplies(4, 4))
        assertFalse(historyFetchApplies(4, 5))
        assertTrue(invalidatesHistory(HISTORY_RIDER_CANCELLATION))
        assertTrue(invalidatesHistory(HISTORY_CUSTOMER_CANCELLATION))
        assertFalse(invalidatesHistory("DELIVERED"))
        assertEquals(listOf("Vehicle problem", "Bike would not start"), historyCancellationCopy("Vehicle problem", "Bike would not start"))
        assertEquals(listOf("Customer cancelled"), historyCancellationCopy("Customer cancelled", "  "))
    }

    @Test
    fun appendPageDeduplicatesAndPreservesExistingRows() {
        val first = parcel("first", "DELIVERED", "2026-10-20T08:00:00Z")
        val second = parcel("second", "DELIVERED", "2026-10-19T08:00:00Z")
        val board = CompletedBoard(loaded = true, deliveries = listOf(first), nextCursor = "opaque", paging = true)
        val result = com.riders.rider.feature.delivery.domain.appendCompletedPage(board, listOf(first, second), null)
        assertEquals(listOf(first, second), result.deliveries)
        assertNull(result.nextCursor)
        assertFalse(result.paging)
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
