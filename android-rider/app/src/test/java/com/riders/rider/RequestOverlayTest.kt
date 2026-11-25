package com.riders.rider

import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.offers.domain.RequestBackTarget
import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.requestBackTarget
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.riderExpiryDisplay
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
import com.riders.rider.feature.bids.data.OPEN_REQUESTS_REUSE_MS
import com.riders.rider.feature.bids.data.recentOpenRequestsReusable
import com.riders.rider.feature.offers.domain.cachedNotificationOffer
import com.riders.rider.feature.offers.domain.openNotificationRequest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
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
    fun aRenewedRequestReplacesTheExpiredAttemptInBothViews() {
        val now = Instant.parse("2026-10-28T11:10:00Z").toEpochMilli()
        val expired = requestOffer("delivery-1", "4.00").copy(
            expiresAt = "2026-10-28T11:06:00Z",
            searchExpiresAt = "2026-10-28T11:06:00Z",
        )
        val renewed = requestOffer("delivery-1", "5.00").copy(
            expiresAt = "2026-10-28T11:16:00Z",
            searchExpiresAt = "2026-10-28T11:16:00Z",
        )
        val mapped = requestForMap(listOf(expired), listOf(renewed), "delivery-1")
        val listed = requestCatalog(listOf(expired), listOf(renewed)).single()
        assertEquals("5.00", mapped?.offeredPrice)
        assertEquals("5.00", listed.offeredPrice)
        assertEquals(riderExpiryDisplay(renewed.searchExpiresAt, renewed.expiresAt, now), riderExpiryDisplay(mapped!!.searchExpiresAt, mapped.expiresAt, now))
        assertEquals("Expires in 6:00", riderExpiryDisplay(mapped.searchExpiresAt, mapped.expiresAt, now))
        assertFalse(requestCountdownExpired(mapped.searchExpiresAt, mapped.expiresAt, now))
        assertTrue(requestCountdownExpired(expired.searchExpiresAt, expired.expiresAt, now))
        val minimized = riderExpiryDisplay(listed.searchExpiresAt, listed.expiresAt, now)
        val expanded = riderExpiryDisplay(mapped.searchExpiresAt, mapped.expiresAt, now)
        assertEquals(minimized, expanded)
        val later = now + 60_000L
        assertEquals("Expires in 5:00", riderExpiryDisplay(mapped.searchExpiresAt, mapped.expiresAt, later))
        assertFalse(requestCountdownExpired(mapped.searchExpiresAt, mapped.expiresAt, later))
        assertTrue(requestCountdownExpired("", "", now).not())
        val openEnded = requestOffer("delivery-2", "1.00").copy(expiresAt = "", searchExpiresAt = null)
        assertFalse(requestCountdownExpired(openEnded.searchExpiresAt, openEnded.expiresAt, now))
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

    @Test
    fun aCachedNotificationIsReadyBeforeTheRequestListReturns() = runTest {
        val offer = requestOffer("delivery-1", "4.00").copy(expiresAt = "2099-01-01T00:00:00.000Z")
        val match = { offers: List<OfferResponse>, id: String -> offers.firstOrNull { it.deliveryId == id } }
        assertEquals("delivery-1", cachedNotificationOffer("delivery-1", listOf(offer), emptySet(), 0L, match)?.deliveryId)
        assertNull(cachedNotificationOffer("delivery-1", listOf(offer), setOf("delivery-1"), 0L, match))
        val started = currentTime
        var ownBidsFinished = false
        val result = openNotificationRequest(
            scope = this,
            tappedId = "delivery-1",
            cached = listOf(offer),
            settled = emptySet(),
            nowMillis = 0L,
            loadRequests = { delay(80); listOf(offer) },
            loadOwnBids = { delay(200); ownBidsFinished = true },
            match = match,
        )
        assertEquals(80L, currentTime - started)
        assertFalse(ownBidsFinished)
        assertEquals("delivery-1", result.offer?.deliveryId)
        assertTrue(result.confirmed)
    }

    @Test
    fun thePreviousNotificationPathWaitedForTheRequestListAndOwnBids() = runTest {
        val started = currentTime
        delay(80)
        delay(200)
        assertEquals(280L, currentTime - started)
    }

    @Test
    fun aMissingOrExpiredNotificationStaysClosedAfterTheRequestList() = runTest {
        val expired = requestOffer("delivery-1", "4.00").copy(expiresAt = "2020-01-01T00:00:00.000Z")
        val match = { offers: List<OfferResponse>, id: String -> offers.firstOrNull { it.deliveryId == id } }
        val missing = openNotificationRequest(
            scope = this,
            tappedId = "delivery-9",
            cached = emptyList(),
            settled = emptySet(),
            nowMillis = 1_900_000_000_000,
            loadRequests = { listOf(expired) },
            loadOwnBids = {},
            match = match,
        )
        assertNull(missing.offer)
        assertTrue(missing.confirmed)
        val closed = openNotificationRequest(
            scope = this,
            tappedId = "delivery-1",
            cached = listOf(expired),
            settled = emptySet(),
            nowMillis = 1_900_000_000_000,
            loadRequests = { listOf(expired) },
            loadOwnBids = {},
            match = match,
        )
        assertNull(closed.offer)
        assertTrue(closed.confirmed)
    }

    @Test
    fun aFailedRequestRefreshKeepsTheCachedNotification() = runTest {
        val offer = requestOffer("delivery-1", "4.00").copy(expiresAt = "2099-01-01T00:00:00.000Z")
        val result = openNotificationRequest(
            scope = this,
            tappedId = "delivery-1",
            cached = listOf(offer),
            settled = emptySet(),
            nowMillis = 0L,
            loadRequests = { null },
            loadOwnBids = {},
            match = { offers, id -> offers.firstOrNull { it.deliveryId == id } },
        )
        assertEquals("delivery-1", result.offer?.deliveryId)
        assertFalse(result.confirmed)
    }

    @Test
    fun aRequestListFetchedForALinkIsReusedBriefly() {
        assertEquals(4_000L, OPEN_REQUESTS_REUSE_MS)
        assertFalse(recentOpenRequestsReusable(0L, 1_000L))
        assertTrue(recentOpenRequestsReusable(1_000L, 1_000L))
        assertTrue(recentOpenRequestsReusable(1_000L, 5_000L))
        assertFalse(recentOpenRequestsReusable(1_000L, 5_001L))
        assertFalse(recentOpenRequestsReusable(2_000L, 1_000L))
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
