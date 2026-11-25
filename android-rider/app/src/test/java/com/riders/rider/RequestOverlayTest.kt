package com.riders.rider

import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.offers.domain.RequestBackTarget
import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.requestBackTarget
import com.riders.rider.feature.offers.domain.requestCatalog
import com.riders.rider.feature.offers.domain.requestForMap
import com.riders.rider.feature.offers.domain.RequestMapSuccess
import com.riders.rider.feature.offers.domain.RequestOverlay
import com.riders.rider.feature.offers.domain.dismissedForSettledAttempts
import com.riders.rider.feature.delivery.domain.toastDismissed
import com.riders.rider.feature.offers.domain.handleRequestMapSuccess
import com.riders.rider.feature.offers.domain.offerSentToast
import com.riders.rider.feature.offers.domain.overlayAfterSearchAttempt
import com.riders.rider.feature.offers.domain.requestActionAllowed
import com.riders.rider.feature.offers.domain.searchAttemptKey
import com.riders.rider.feature.offers.domain.requestMapAutoOpenBlocked
import com.riders.rider.feature.offers.domain.requestMapNotice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestOverlayTest {
    @Test
    fun opensTheFirstEligibleRequestAndKeepsItWhenAnotherArrives() {
        val first = RequestOverlay().sync(listOf("a"), blocked = false)
        assertEquals("a", first.openId)
        val kept = first.sync(listOf("a", "b"), blocked = false)
        assertEquals("a", kept.openId)
    }

    @Test
    fun dismissKeepsTheRequestClosedUntilItIsOpenedAgain() {
        val open = RequestOverlay().sync(listOf("a", "b"), blocked = false)
        val dismissed = open.dismiss()
        assertNull(dismissed.openId)
        assertEquals("b", dismissed.sync(listOf("a", "b"), blocked = false).openId)
        val again = dismissed.sync(listOf("a"), blocked = false)
        assertNull(again.openId)
        assertEquals("a", again.open("a").openId)
    }

    @Test
    fun closesARequestThatLeavesAndDoesNotOpenWhileBlocked() {
        val open = RequestOverlay(openId = "a")
        assertNull(open.sync(emptyList(), blocked = false).openId)
        val waiting = RequestOverlay().sync(listOf("a"), blocked = true)
        assertNull(waiting.openId)
        assertEquals("a", RequestOverlay(openId = "a").sync(listOf("a"), blocked = true).openId)
    }

    @Test
    fun directAcceptClosesTheOpenMapAndNavigatesOnce() {
        val open = RequestOverlay(openId = "delivery-1")
        val handling = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.Accepted))
        assertNull(handling.overlay.openId)
        assertTrue(handling.openDeliveries)
        assertFalse(handling.showOfferSent)
        val again = handleRequestMapSuccess(handling.overlay, RequestMapEvent("delivery-1", RequestMapSuccess.Accepted))
        assertFalse(again.openDeliveries)
        assertFalse(again.showOfferSent)
        assertNull(again.overlay.sync(listOf("delivery-1", "delivery-2"), blocked = false).openId?.let { id ->
            if (id == "delivery-1") id else null
        })
        assertEquals("delivery-2", handling.overlay.sync(listOf("delivery-1", "delivery-2"), blocked = false).openId)
    }

    @Test
    fun directAcceptFailureKeepsTheMapAndShowsTheError() {
        val open = RequestOverlay(openId = "delivery-1")
        assertEquals("delivery-1", open.openId)
        assertEquals("A fresh location is required", requestMapNotice(null, "A fresh location is required"))
        assertNull(requestMapNotice(null, null))
    }

    @Test
    fun listedAndCustomOfferSuccessCloseTheMapAndShowOneToast() {
        val open = RequestOverlay(openId = "delivery-1")
        val listed = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent))
        val custom = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent))
        assertNull(listed.overlay.openId)
        assertTrue(listed.showOfferSent)
        assertFalse(listed.openDeliveries)
        assertTrue(custom.showOfferSent)
        assertFalse(handleRequestMapSuccess(listed.overlay, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent)).showOfferSent)
        val toast = offerSentToast("delivery-1", "2026-11-25T10:00:00Z")
        assertEquals("offer-sent:delivery-1|2026-11-25T10:00:00Z", toast?.id)
        assertEquals("Offer sent", toast?.title)
        assertEquals("Waiting for the customer to respond.", toast?.detail)
        assertEquals(6_000L, toast?.dismissMs)
        val shownAt = 1_000L
        assertFalse(toastDismissed(shownAt, shownAt + toast!!.dismissMs - 1, toast.dismissMs))
        assertTrue(toastDismissed(shownAt, shownAt + toast.dismissMs, toast.dismissMs))
        assertNull(offerSentToast(" ", null))
        assertFalse(requestMapAutoOpenBlocked(offlineConfirmation = false))
        assertTrue(requestMapAutoOpenBlocked(offlineConfirmation = false, offerSentHold = true))
        assertNull(listed.overlay.sync(listOf("delivery-1", "delivery-2"), blocked = true).openId)
    }

    @Test
    fun declineSuccessClosesTheMapWithoutADialog() {
        val open = RequestOverlay(openId = "delivery-1")
        val handling = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.Declined))
        assertNull(handling.overlay.openId)
        assertFalse(handling.showOfferSent)
        assertFalse(handling.openDeliveries)
    }

    @Test
    fun declineFailureKeepsTheMapOpen() {
        val open = RequestOverlay(openId = "delivery-1")
        assertEquals("delivery-1", open.openId)
        assertEquals("Could not decline", requestMapNotice("Could not decline", null))
    }

    @Test
    fun aStaleResultDoesNotNavigateOrShowAnotherDialog() {
        val open = RequestOverlay(openId = "delivery-2")
        val staleAccept = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.Accepted))
        val staleOffer = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent))
        assertEquals("delivery-2", staleAccept.overlay.openId)
        assertFalse(staleAccept.openDeliveries)
        assertFalse(staleOffer.showOfferSent)
        assertEquals("delivery-2", staleOffer.overlay.openId)
    }

    @Test
    fun pollingCannotReopenAHandledRequestButOtherRequestsStayAvailable() {
        val handled = RequestOverlay(openId = "delivery-1")
            .dismiss()
        assertNull(handled.sync(listOf("delivery-1"), blocked = false).openId)
        assertEquals("delivery-2", handled.sync(listOf("delivery-1", "delivery-2"), blocked = false).openId)
        assertEquals("delivery-2", handled.open("delivery-2").openId)
        assertFalse(requestMapAutoOpenBlocked(offlineConfirmation = false))
    }

    @Test
    fun loadingAndASettledRequestBlockAnotherSubmission() {
        assertFalse(requestActionAllowed("delivery-1", emptySet(), accepting = true, submitting = false, declining = false))
        assertFalse(requestActionAllowed("delivery-1", emptySet(), accepting = false, submitting = true, declining = false))
        assertFalse(requestActionAllowed("delivery-1", emptySet(), accepting = false, submitting = false, declining = true))
        assertFalse(requestActionAllowed("delivery-1", setOf("delivery-1"), accepting = false, submitting = false, declining = false))
        assertTrue(requestActionAllowed("delivery-2", setOf("delivery-1"), accepting = false, submitting = false, declining = false))
    }

    @Test
    fun browsingTheListDoesNotAutoOpenButKeepsAnExplicitRequest() {
        val blocked = requestMapAutoOpenBlocked(offlineConfirmation = false, browsingRequests = true)
        val browsing = RequestOverlay().sync(listOf("a", "b"), blocked = blocked)
        assertNull(browsing.openId)
        val chosen = browsing.open("b")
        assertEquals("b", chosen.openId)
        assertEquals("b", chosen.sync(listOf("a", "b"), blocked = blocked).openId)
    }

    @Test
    fun closingTheMapReturnsToTheListAndClosingTheListReturnsHome() {
        assertEquals(RequestBackTarget.Dashboard, requestBackTarget(mapOpen = true, listOpen = false))
        assertEquals(RequestBackTarget.Requests, requestBackTarget(mapOpen = true, listOpen = true))
        assertEquals(RequestBackTarget.Dashboard, requestBackTarget(mapOpen = false, listOpen = true))
    }

    @Test
    fun theOpenRequestUsesTheSharedCatalogBeforeTheHomeSnapshot() {
        val shared = requestOffer("shared", "4.00")
        val home = requestOffer("shared", "9.00")
        val onlyHome = requestOffer("home-only", "2.00")
        assertEquals("4.00", requestForMap(listOf(shared), listOf(home, onlyHome), "shared")?.offeredPrice)
        assertEquals("2.00", requestForMap(emptyList(), listOf(onlyHome), "home-only")?.offeredPrice)
        assertNull(requestForMap(listOf(shared), listOf(onlyHome), "missing"))
        assertEquals(listOf("home-only", "shared"), requestCatalog(listOf(shared), listOf(onlyHome, home)).map { it.deliveryId })
    }

    @Test
    fun aNewSearchAttemptIsActionableAfterThePreviousAttemptSettled() {
        val first = "2026-10-28T11:06:00.000Z"
        val renewed = "2026-10-28T12:06:00.000Z"
        val settled = setOf(searchAttemptKey("delivery-1", first))
        assertFalse(requestActionAllowed("delivery-1", settled, accepting = false, submitting = false, declining = false, searchDeadline = first))
        assertFalse(requestActionAllowed("delivery-1", settled, accepting = true, submitting = false, declining = false, searchDeadline = renewed))
        assertTrue(requestActionAllowed("delivery-1", settled, accepting = false, submitting = false, declining = false, searchDeadline = renewed))
        assertTrue(requestActionAllowed("delivery-1", setOf("delivery-1"), accepting = false, submitting = false, declining = false, searchDeadline = renewed))
        assertEquals(setOf("delivery-1"), dismissedForSettledAttempts(listOf("delivery-1" to first), settled))
        assertEquals(emptySet<String>(), dismissedForSettledAttempts(listOf("delivery-1" to renewed), settled))
        val closed = RequestOverlay(dismissed = setOf("delivery-1"))
        val same = overlayAfterSearchAttempt(closed, mapOf("delivery-1" to first), listOf("delivery-1" to first))
        assertEquals(setOf("delivery-1"), same.first.dismissed)
        val released = overlayAfterSearchAttempt(closed, mapOf("delivery-1" to first), listOf("delivery-1" to renewed))
        assertEquals(emptySet<String>(), released.first.dismissed)
        val manual = overlayAfterSearchAttempt(closed, emptyMap(), listOf("delivery-1" to renewed))
        assertEquals(setOf("delivery-1"), manual.first.dismissed)
    }
}

private fun requestOffer(deliveryId: String, price: String): OfferResponse {
    val stop = StopResponse(address = "Address", contactName = "Rider", contactPhone = "000")
    return OfferResponse(
        assignmentId = deliveryId,
        deliveryId = deliveryId,
        expiresAt = "2026-10-28T12:00:00Z",
        offeredPrice = price,
        currency = "USD",
        payer = "SENDER",
        paymentMethod = "CASH",
        parcel = ParcelResponse(description = "Parcel", size = "SMALL"),
        pickup = stop,
        dropoff = stop,
    )
}
