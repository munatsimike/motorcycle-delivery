package com.riders.rider

import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.DeliveryContacts
import com.riders.rider.feature.delivery.domain.agreedPriceLabel
import com.riders.rider.feature.delivery.domain.applyAssignmentRefresh
import com.riders.rider.feature.delivery.domain.committedAssignmentsForDisplay
import com.riders.rider.feature.delivery.domain.deadlineLabel
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.parcelRoute
import com.riders.rider.feature.delivery.domain.selectedParcel
import com.riders.rider.feature.delivery.domain.serviceClassLabel
import com.riders.rider.navigation.deliveriesShowsActiveDelivery
import com.riders.rider.navigation.deliveriesShowsAssignmentList
import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.delivery.domain.AssignmentCertainty
import com.riders.rider.feature.delivery.domain.DeliveriesPane
import com.riders.rider.feature.delivery.domain.assignmentFailureIsUncertain
import com.riders.rider.feature.delivery.domain.automaticAssignmentRetry
import com.riders.rider.feature.delivery.domain.deliveriesPane
import com.riders.rider.feature.delivery.domain.hasCommittedV2
import com.riders.rider.feature.delivery.domain.parcelActionsAllowed
import com.riders.rider.feature.delivery.domain.recoverAssignments
import com.riders.rider.feature.delivery.domain.retryWhenConnectivityReturns
import com.riders.rider.feature.delivery.domain.staleAssignmentHintAuthorizes
import com.riders.rider.feature.home.receivingControl
import com.riders.rider.feature.home.receivingAfterRefresh
import com.riders.rider.navigation.deliveriesShowsBidBoard
import com.riders.rider.navigation.deliveriesShowsOffers
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderAssignmentListTest {
    @Test
    fun anEmptyListStaysEmpty() {
        val shown = committedAssignmentsForDisplay(emptyList(), "AVAILABLE", true)
        assertTrue(shown.isEmpty())
    }

    @Test
    fun oneFlexibleAssignmentKeepsItsReadFields() {
        val parcel = parcel("flex-1", "FLEXIBLE", "RIDER_ASSIGNED", "12.50", "2026-10-25T16:00:00Z")
        val shown = committedAssignmentsForDisplay(listOf(parcel), "AVAILABLE", true)
        assertEquals(1, shown.size)
        assertEquals("Flexible", serviceClassLabel(shown[0].serviceClass))
        assertEquals("Rider assigned", deliveryStatusLabel(shown[0].status))
        assertEquals("Deliver by 25 Oct 2026, 16:00", deadlineLabel(shown[0].deliverBy, ZoneOffset.UTC))
        assertEquals("Agreed price USD 12.50", agreedPriceLabel(shown[0].agreedPrice))
        assertEquals("Pickup flex-1", shown[0].pickupAddress)
        assertEquals("Documents flex-1", shown[0].parcelDescription)
    }

    @Test
    fun multipleFlexibleAssignmentsStayInBackendOrder() {
        val first = parcel("older", "FLEXIBLE", "COLLECTING", "4.00", null)
        val second = parcel("newer", "FLEXIBLE", "RIDER_ASSIGNED", "5.00", null)
        val shown = committedAssignmentsForDisplay(listOf(first, second), "OFFLINE", false)
        assertEquals(listOf("older", "newer"), shown.map { it.deliveryId })
        assertEquals(listOf("Flexible", "Flexible"), shown.map { serviceClassLabel(it.serviceClass) })
    }

    @Test
    fun twoFlexibleAssignmentsAndOneExpressShareOneList() {
        val assignments = listOf(
            parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", "2026-10-25T16:00:00Z"),
            parcel("flex-b", "FLEXIBLE", "COLLECTED", "6.00", "2026-10-25T18:00:00Z"),
            parcel("express-1", "EXPRESS", "COLLECTING", "9.00", "2026-10-25T15:00:00Z"),
        )
        val shown = committedAssignmentsForDisplay(assignments, "AVAILABLE", true)
        assertEquals(listOf("flex-a", "flex-b", "express-1"), shown.map { it.deliveryId })
        assertEquals(listOf("Flexible", "Flexible", "Express"), shown.map { serviceClassLabel(it.serviceClass) })
        assertEquals("Collecting", deliveryStatusLabel(shown[2].status))
        assertEquals("Agreed price USD 9.00", agreedPriceLabel(shown[2].agreedPrice))
    }

    @Test
    fun openingAParcelUsesItsDeliveryIdAndLeavesTheListIntact() {
        val assignments = listOf(
            parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null),
            parcel("express-1", "EXPRESS", "COLLECTING", "9.00", null),
        )
        val selected = selectedParcel(assignments, "express-1")
        assertEquals("express-1", selected?.deliveryId)
        assertEquals("Express rider", selected?.contacts?.pickupName)
        assertEquals("delivery/express-1", parcelRoute("express-1"))
        assertEquals(listOf("flex-a", "express-1"), assignments.map { it.deliveryId })
        assertNull(selectedParcel(assignments, "missing"))
    }

    @Test
    fun removingOneAssignmentLeavesItsSiblings() {
        val assignments = listOf(
            parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null),
            parcel("flex-b", "FLEXIBLE", "COLLECTED", "6.00", null),
            parcel("express-1", "EXPRESS", "COLLECTING", "9.00", null),
        )
        val remaining = applyAssignmentRefresh(
            current = assignments,
            requestGeneration = 2,
            latestGeneration = 2,
            incoming = assignments.filter { it.deliveryId != "flex-b" },
        )
        assertEquals(listOf("flex-a", "express-1"), remaining.map { it.deliveryId })
        assertEquals("Flexible", serviceClassLabel(remaining[0].serviceClass))
        assertEquals("Express", serviceClassLabel(remaining[1].serviceClass))
    }

    @Test
    fun offlineAndPausedReceivingStillShowCommittedAssignments() {
        val assignments = listOf(parcel("flex-a", "FLEXIBLE", "OUT_FOR_DELIVERY", "4.00", null))
        assertEquals(assignments, committedAssignmentsForDisplay(assignments, "OFFLINE", false))
        assertEquals(assignments, committedAssignmentsForDisplay(assignments, "OFFLINE", true))
        assertEquals(assignments, committedAssignmentsForDisplay(assignments, "AVAILABLE", false))
        assertFalse(deliveriesShowsOffers("OFFLINE"))
        assertFalse(deliveriesShowsActiveDelivery("OFFLINE"))
        assertTrue(deliveriesShowsAssignmentList(false))
    }

    @Test
    fun flagOffKeepsTwoCommittedDeliveriesAndHidesNewBids() {
        val committed = listOf(
            parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null),
            parcel("flex-b", "FLEXIBLE", "COLLECTING", "5.00", null),
        )
        val kept = applyAssignmentRefresh(committed, requestGeneration = 3, latestGeneration = 3, incoming = null)
        assertEquals(listOf("flex-a", "flex-b"), kept.map { it.deliveryId })
        assertTrue(hasCommittedV2(kept.map { it.serviceClass }))
        assertTrue(deliveriesShowsAssignmentList(null, committedV2 = true))
        assertFalse(deliveriesShowsBidBoard(null))
        assertEquals(true, receivingAfterRefresh(previous = true, loaded = null, loadedFromServer = false))
        assertEquals(null, receivingAfterRefresh(previous = true, loaded = null, loadedFromServer = true))
        assertFalse(hasCommittedV2(listOf(null, "ASSIGNED")))
        assertFalse(deliveriesShowsAssignmentList(null, committedV2 = false))
    }

    @Test
    fun processRestartRecoversCommittedFlexibleDeliveriesFromTheServer() {
        val fetched = listOf(
            parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null),
            parcel("flex-b", "FLEXIBLE", "COLLECTING", "5.00", null),
        )
        val recovered = recoverAssignments(
            fetchSucceeded = true,
            fetched = fetched,
            confirmed = emptyList(),
            confirmedThisProcess = false,
            failureUncertain = false,
        )
        assertEquals(AssignmentCertainty.Confirmed, recovered.certainty)
        assertEquals(listOf("flex-a", "flex-b"), recovered.parcels.map { it.deliveryId })
        assertEquals(DeliveriesPane.Committed, deliveriesPane(receiving = null, recovered))
        assertTrue(parcelActionsAllowed(recovered.certainty))
        assertFalse(deliveriesShowsBidBoard(null))
        assertFalse(receivingControl(receiving = null, canAcceptDeliveries = true, changing = false).visible)
    }

    @Test
    fun processRestartWithAFailedFetchStaysUnknown() {
        val stale = listOf(parcel("flex-a", "FLEXIBLE", "COLLECTING", "4.00", null))
        val recovered = recoverAssignments(
            fetchSucceeded = false,
            fetched = emptyList(),
            confirmed = stale,
            confirmedThisProcess = false,
            failureUncertain = true,
        )
        assertEquals(AssignmentCertainty.Unknown, recovered.certainty)
        assertTrue(recovered.parcels.isEmpty())
        assertEquals(DeliveriesPane.Recover, deliveriesPane(receiving = null, recovered))
        assertFalse(parcelActionsAllowed(recovered.certainty))
        assertFalse(staleAssignmentHintAuthorizes(staleCommittedHint = true))
        assertFalse(deliveriesShowsOffers("AVAILABLE") && recovered.certainty == AssignmentCertainty.Confirmed)
        assertTrue(retryWhenConnectivityReturns(refreshPending = true, networkAvailable = true))
        assertFalse(retryWhenConnectivityReturns(refreshPending = false, networkAvailable = true))
        assertTrue(automaticAssignmentRetry(0))
        assertTrue(automaticAssignmentRetry(2))
        assertFalse(automaticAssignmentRetry(3))
        assertFalse(assignmentFailureIsUncertain(ApiError.SessionEnded))
        assertFalse(assignmentFailureIsUncertain(ApiError.Forbidden))
        assertTrue(assignmentFailureIsUncertain(ApiError.Network))
    }

    @Test
    fun aTemporaryAssignmentFailureKeepsTheConfirmedList() {
        val confirmed = listOf(parcel("flex-a", "FLEXIBLE", "COLLECTING", "4.00", null))
        val recovered = recoverAssignments(
            fetchSucceeded = false,
            fetched = emptyList(),
            confirmed = confirmed,
            confirmedThisProcess = true,
            failureUncertain = true,
        )
        assertEquals(AssignmentCertainty.Confirmed, recovered.certainty)
        assertEquals(listOf("flex-a"), recovered.parcels.map { it.deliveryId })
        assertTrue(parcelActionsAllowed(recovered.certainty))
        assertEquals(DeliveriesPane.Committed, deliveriesPane(receiving = null, recovered))
    }

    @Test
    fun anAuthoritativeFailureDoesNotAuthorizeTheCachedList() {
        val confirmed = listOf(parcel("flex-a", "FLEXIBLE", "COLLECTING", "4.00", null))
        val recovered = recoverAssignments(
            fetchSucceeded = false,
            fetched = emptyList(),
            confirmed = confirmed,
            confirmedThisProcess = true,
            failureUncertain = false,
        )
        assertEquals(AssignmentCertainty.Unknown, recovered.certainty)
        assertTrue(recovered.parcels.isEmpty())
        assertFalse(parcelActionsAllowed(recovered.certainty))
    }

    @Test
    fun confirmedEmptyAssignmentsKeepV1Navigation() {
        val recovered = recoverAssignments(
            fetchSucceeded = true,
            fetched = emptyList(),
            confirmed = listOf(parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null)),
            confirmedThisProcess = true,
            failureUncertain = false,
        )
        assertEquals(DeliveriesPane.V1, deliveriesPane(receiving = null, recovered))
        assertTrue(deliveriesShowsOffers("AVAILABLE"))
        assertTrue(deliveriesShowsActiveDelivery("BUSY"))
    }

    @Test
    fun aFailedRefreshKeepsTheLastConfirmedList() {
        val confirmed = listOf(parcel("flex-a", "FLEXIBLE", "RIDER_ASSIGNED", "4.00", null))
        val kept = applyAssignmentRefresh(confirmed, requestGeneration = 4, latestGeneration = 4, incoming = null)
        assertEquals(listOf("flex-a"), kept.map { it.deliveryId })
    }

    @Test
    fun aStaleResponseDoesNotReplaceNewerAssignments() {
        val newer = listOf(
            parcel("flex-a", "FLEXIBLE", "COLLECTING", "4.00", null),
            parcel("express-1", "EXPRESS", "RIDER_ASSIGNED", "9.00", null),
        )
        val stale = listOf(parcel("old", "FLEXIBLE", "RIDER_ASSIGNED", "1.00", null))
        val kept = applyAssignmentRefresh(newer, requestGeneration = 1, latestGeneration = 2, incoming = stale)
        assertEquals(listOf("flex-a", "express-1"), kept.map { it.deliveryId })
    }

    @Test
    fun aRefreshRecoversAnAssignmentAcceptedWhileTheAppWasClosed() {
        val recovered = applyAssignmentRefresh(
            current = emptyList(),
            requestGeneration = 1,
            latestGeneration = 1,
            incoming = listOf(parcel("missed", "FLEXIBLE", "RIDER_ASSIGNED", "7.50", "2026-10-26T09:00:00Z")),
        )
        assertEquals("missed", recovered.single().deliveryId)
        assertEquals("Agreed price USD 7.50", agreedPriceLabel(recovered.single().agreedPrice))
    }

    @Test
    fun theMarketplaceFlagOffKeepsTheSingularDeliveryNavigation() {
        assertFalse(deliveriesShowsAssignmentList(null))
        assertTrue(deliveriesShowsOffers("AVAILABLE"))
        assertTrue(deliveriesShowsActiveDelivery("BUSY"))
        assertEquals("delivery/delivery-1", parcelRoute("delivery-1"))
    }

    @Test
    fun aCommittedParcelOpensMapsForItsOwnStop() {
        val collecting = parcel("express-1", "EXPRESS", "COLLECTING", "9.00", null)
        val collected = collecting.copy(status = "COLLECTED")
        val pickup = navigationTarget("COLLECTING", collecting.contacts, collecting.pickupAddress, null, collecting.dropoffAddress, null)
        val dropoff = navigationTarget("COLLECTED", collected.contacts, collected.pickupAddress, null, collected.dropoffAddress, null)
        assertTrue(pickup?.uri?.contains("-17.1000000,31.1000000") == true)
        assertTrue(dropoff?.uri?.contains("-17.2000000,31.2000000") == true)
    }

    private fun parcel(
        deliveryId: String,
        serviceClass: String,
        status: String,
        agreedPrice: String,
        deliverBy: String?,
    ) = CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = "assignment-$deliveryId",
        status = status,
        serviceClass = serviceClass,
        deliverBy = deliverBy,
        agreedPrice = agreedPrice,
        parcelDescription = "Documents $deliveryId",
        parcelSize = "SMALL",
        pickupAddress = "Pickup $deliveryId",
        dropoffAddress = "Dropoff $deliveryId",
        contacts = DeliveryContacts(
            pickupName = "Express rider".takeIf { serviceClass == "EXPRESS" } ?: "Flexible rider",
            pickupPhone = "+263771111111",
            pickupLatitude = "-17.1000000",
            pickupLongitude = "31.1000000",
            dropoffName = "Recipient $deliveryId",
            dropoffPhone = "+263772222222",
            dropoffLatitude = "-17.2000000",
            dropoffLongitude = "31.2000000",
        ),
    )
}
