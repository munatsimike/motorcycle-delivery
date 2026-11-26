package com.riders.rider

import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.offers.domain.RequestBackTarget
import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.requestBackTarget
import com.riders.rider.feature.offers.domain.EXPIRED_REQUEST_DISMISS_MS
import com.riders.rider.feature.offers.domain.millisUntilExpiredRequestCloses
import com.riders.rider.feature.offers.domain.closeExpiredRequest
import com.riders.rider.feature.offers.domain.requestAttemptIdentity
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.IncomingRequestGate
import com.riders.rider.feature.offers.domain.autoOpenRequestIds
import com.riders.rider.feature.offers.domain.retainOpenRequest
import com.riders.rider.feature.offers.domain.retainActionableRequests
import com.riders.rider.feature.offers.domain.stepIncomingRequest
import com.riders.rider.feature.offers.domain.watchHomeRequests
import com.riders.rider.feature.offers.domain.riderCountdownDeadlineMillis
import com.riders.rider.feature.offers.domain.riderExpiryDisplay
import com.riders.rider.feature.offers.domain.requestCatalog
import com.riders.rider.feature.offers.domain.requestForMap
import com.riders.rider.feature.offers.domain.RequestMapSuccess
import com.riders.rider.feature.offers.domain.RequestOverlay
import com.riders.rider.feature.offers.domain.dismissedForSettledAttempts
import com.riders.rider.feature.delivery.domain.toastDismissed
import com.riders.rider.feature.offers.domain.handleRequestMapSuccess
import com.riders.rider.feature.offers.domain.withoutSettledRequests
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.advanceTimeBy
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
        assertTrue("delivery-1" in handling.overlay.dismissed)
        assertTrue(handling.overlay.minimised.isEmpty())
        assertTrue(handling.openDeliveries)
        assertFalse(handling.showOfferSent)
        val cleared = handleRequestMapSuccess(open.copy(openId = null), RequestMapEvent("delivery-1", RequestMapSuccess.Accepted))
        assertTrue(cleared.openDeliveries)
        assertTrue("delivery-1" in cleared.overlay.dismissed)
        assertTrue(cleared.overlay.minimised.isEmpty())
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
        assertTrue(listed.overlay.minimised.isEmpty())
        assertTrue(listed.showOfferSent)
        val offers = listOf(requestOffer("delivery-1", "2.00"), requestOffer("delivery-2", "3.00"))
        val settled = setOf(searchAttemptKey("delivery-1", offers[0].searchExpiresAt))
        assertEquals(listOf("delivery-2"), withoutSettledRequests(offers, settled).map { it.deliveryId })
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
        assertEquals("delivery-2", listed.overlay.sync(listOf("delivery-1", "delivery-2"), blocked = false).openId)
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
    fun decliningHomeOnlyRequestRemovesBothViewsBeforeRefresh() {
        val offer = requestOffer("delivery-1", "2.00").copy(searchExpiresAt = "2026-10-28T12:06:00Z")
        val other = requestOffer("delivery-2", "3.00")
        val settled = setOf(searchAttemptKey(offer.deliveryId, offer.searchExpiresAt))
        val home = withoutSettledRequests(listOf(offer, other), settled)
        val map = withoutSettledRequests(emptyList(), settled)
        assertEquals(listOf(other), requestCatalog(map, home))
        assertNull(requestForMap(map, home, offer.deliveryId))
        val result = handleRequestMapSuccess(RequestOverlay(openId = offer.deliveryId),
            RequestMapEvent(offer.deliveryId, RequestMapSuccess.Declined, offer.searchExpiresAt))
        assertNull(result.overlay.openId)
        assertTrue(result.overlay.minimised.isEmpty())
        assertFalse(result.showOfferSent)
    }

    @Test
    fun declineSuppressesStaleRefreshButNotRenewedSearch() {
        val offer = requestOffer("delivery-1", "2.00").copy(searchExpiresAt = "2026-10-28T12:06:00Z")
        val older = offer.copy(searchExpiresAt = "2026-10-28T11:06:00Z")
        val renewed = offer.copy(searchExpiresAt = "2026-10-28T13:06:00Z")
        val settled = setOf(searchAttemptKey(offer.deliveryId, offer.searchExpiresAt))
        assertEquals(listOf(renewed), withoutSettledRequests(listOf(older, offer, renewed), settled))
        val open = RequestOverlay(openId = renewed.deliveryId)
        val event = RequestMapEvent(offer.deliveryId, RequestMapSuccess.Declined, offer.searchExpiresAt)
        assertEquals(open, handleRequestMapSuccess(open, event, renewed.searchExpiresAt).overlay)
        val other = RequestOverlay(openId = "delivery-2")
        assertEquals(other, handleRequestMapSuccess(other, event).overlay)
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
    fun anExpiredRequestStaysForThreeSecondsThenLeavesWithoutClosingAnother() {
        assertEquals(3_000L, EXPIRED_REQUEST_DISMISS_MS)
        val search = "2026-10-28T11:00:00Z"
        val expires = "2026-10-28T11:00:05Z"
        val deadline = riderCountdownDeadlineMillis(search, expires)
        val now = Instant.parse(search).toEpochMilli()
        assertEquals(3_000L, millisUntilExpiredRequestCloses(now, now))
        assertEquals(1_000L, millisUntilExpiredRequestCloses(now, now + 2_000L))
        assertEquals(0L, millisUntilExpiredRequestCloses(now, now + EXPIRED_REQUEST_DISMISS_MS))
        assertEquals(0L, millisUntilExpiredRequestCloses(now, now + 10_000L))
        assertEquals(now, deadline)
        assertFalse(requestCountdownExpired(search, expires, now - 1L))
        assertTrue(requestCountdownExpired(search, expires, now))
        val expired = requestOffer("delivery-1", "4.00").copy(searchExpiresAt = search, expiresAt = expires)
        val other = requestOffer("delivery-2", "6.00").copy(
            searchExpiresAt = "2026-10-28T11:10:00Z",
            expiresAt = "2026-10-28T11:20:00Z",
        )
        val attempt = requestAttemptIdentity(expired)
        val held = retainActionableRequests(listOf(expired, other), emptyMap(), emptySet(), now)
        assertEquals(listOf("delivery-1", "delivery-2"), held.offers.map { it.deliveryId })
        assertTrue(held.justRetired.isEmpty())
        val stillHeld = retainActionableRequests(listOf(expired, other), held.seenAt, held.retired, now + EXPIRED_REQUEST_DISMISS_MS - 1L)
        assertEquals(listOf("delivery-1", "delivery-2"), stillHeld.offers.map { it.deliveryId })
        val retired = retainActionableRequests(listOf(expired, other), stillHeld.seenAt, stillHeld.retired, now + EXPIRED_REQUEST_DISMISS_MS)
        assertEquals(listOf("delivery-2"), retired.offers.map { it.deliveryId })
        assertEquals(listOf(attempt), retired.justRetired)
        val renewed = expired.copy(searchExpiresAt = "2026-10-28T11:30:00Z", expiresAt = "2026-10-28T11:40:00Z")
        val kept = retainActionableRequests(listOf(renewed, other), held.seenAt, emptySet(), now + 1_000L)
        assertEquals(listOf("delivery-1", "delivery-2"), kept.offers.map { it.deliveryId })
        assertTrue(kept.justRetired.isEmpty())
        assertFalse(requestCountdownExpired(renewed.searchExpiresAt, renewed.expiresAt, now + 1_000L))
        val open = RequestOverlay(openId = "delivery-1")
        val closed = closeExpiredRequest(open, attempt, attempt)
        assertNull(closed.openId)
        assertTrue("delivery-1" in closed.dismissed)
        val otherOpen = closeExpiredRequest(RequestOverlay(openId = "delivery-2"), requestAttemptIdentity(other), attempt)
        assertEquals("delivery-2", otherOpen.openId)
        assertTrue("delivery-1" in otherOpen.dismissed)
        val renewedAttempt = requestAttemptIdentity(renewed)
        val stillOpen = closeExpiredRequest(open, renewedAttempt, attempt)
        assertEquals("delivery-1", stillOpen.openId)
        assertFalse("delivery-1" in stillOpen.dismissed)
        val stale = retainActionableRequests(listOf(expired), emptyMap(), emptySet(), now + EXPIRED_REQUEST_DISMISS_MS + 60_000L)
        assertTrue(stale.offers.isEmpty())
        assertEquals(listOf(attempt), stale.justRetired)
        val openEnded = requestOffer("delivery-3", "1.00").copy(expiresAt = "", searchExpiresAt = null)
        val stays = retainActionableRequests(listOf(openEnded), emptyMap(), emptySet(), now + 60_000L)
        assertEquals(listOf("delivery-3"), stays.offers.map { it.deliveryId })
    }

    @Test
    fun aNewHomeRequestOpensOnceAndDoesNotReplaceOrReturn() {
        val initial = stepIncomingRequest(IncomingRequestGate(), listOf("delivery-1"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertEquals("delivery-1", initial.maximiseId)
        assertTrue(initial.gate.primed)
        val acknowledged = initial.gate.copy(pendingMaximiseId = null)
        val arrived = stepIncomingRequest(acknowledged, listOf("delivery-1", "delivery-2"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertEquals("delivery-2", arrived.maximiseId)
        val whileOpen = stepIncomingRequest(arrived.gate, listOf("delivery-1", "delivery-2", "delivery-3"), listSettled = true, canMaximise = false, suppressedIds = emptySet())
        assertNull(whileOpen.maximiseId)
        assertTrue("delivery-3" in whileOpen.gate.knownIds)
        val away = whileOpen.gate.copy(catchUp = true, pendingMaximiseId = null, heldMaximiseId = null)
        val returned = stepIncomingRequest(away, listOf("delivery-1", "delivery-2", "delivery-4"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertNull(returned.maximiseId)
        val later = stepIncomingRequest(returned.gate, listOf("delivery-1", "delivery-5"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertEquals("delivery-5", later.maximiseId)
        val minimised = RequestOverlay(openId = "delivery-5").minimise()
        assertNull(minimised.openId)
        assertTrue("delivery-5" in minimised.minimised)
        val again = stepIncomingRequest(later.gate, listOf("delivery-5"), listSettled = true, canMaximise = true, suppressedIds = minimised.minimised)
        assertNull(again.maximiseId)
        val closed = RequestOverlay(openId = "delivery-5").dismiss()
        val kept = retainOpenRequest(RequestOverlay(openId = "delivery-2"), listOf("delivery-2", "delivery-3"))
        assertEquals("delivery-2", kept.openId)
        val cleared = retainOpenRequest(kept, listOf("delivery-3"))
        assertNull(cleared.openId)
        assertEquals("delivery-3", retainOpenRequest(RequestOverlay(openId = "delivery-3"), listOf("delivery-3")).openId)
        assertTrue("delivery-5" in closed.dismissed)
        val loading = stepIncomingRequest(IncomingRequestGate(), listOf("delivery-9"), listSettled = false, canMaximise = false, suppressedIds = emptySet())
        assertNull(loading.maximiseId)
        assertFalse(loading.gate.primed)
        assertEquals("delivery-9", loading.gate.heldMaximiseId)
        val ready = stepIncomingRequest(loading.gate, listOf("delivery-9"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertEquals("delivery-9", ready.maximiseId)
        val repeated = stepIncomingRequest(ready.gate, listOf("delivery-9"), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertNull(repeated.maximiseId)
        val dismissedDuringStart = stepIncomingRequest(loading.gate, listOf("delivery-9"), listSettled = true, canMaximise = true, suppressedIds = setOf("delivery-9"))
        assertNull(dismissedDuringStart.maximiseId)
        val expired = requestOffer("delivery-9", "1.00").copy(expiresAt = "2020-01-01T00:00:00Z")
        val live = requestOffer("delivery-8", "1.00").copy(expiresAt = "2099-01-01T00:00:00Z")
        assertEquals(listOf("delivery-8"), autoOpenRequestIds(listOf(expired, live), System.currentTimeMillis()))
        val blocked = stepIncomingRequest(loading.gate, emptyList(), listSettled = true, canMaximise = true, suppressedIds = emptySet())
        assertNull(blocked.maximiseId)
    }

    @Test
    fun aSettledListDoesNotConsumeARequestBeforeHomeIsReady() {
        val loading = stepIncomingRequest(IncomingRequestGate(), listOf("a"), false, false, emptySet())
        val waiting = stepIncomingRequest(loading.gate, listOf("a"), true, false, emptySet(), deferMaximise = true)
        assertNull(waiting.maximiseId)
        assertEquals("a", waiting.gate.heldMaximiseId)
        val ready = stepIncomingRequest(waiting.gate, listOf("a"), true, true, emptySet())
        assertEquals("a", ready.maximiseId)
        val consumed = ready.gate.copy(pendingMaximiseId = null)
        assertNull(stepIncomingRequest(consumed, listOf("a"), true, true, emptySet()).maximiseId)
    }

    @Test
    fun aNewRequestDuringResumeWaitsForHomeAndDoesNotReopenKnownRequests() {
        val initial = stepIncomingRequest(IncomingRequestGate(), listOf("old"), true, true, emptySet())
        val gate = initial.gate.copy(pendingMaximiseId = null)
        val waiting = stepIncomingRequest(gate, listOf("old", "new"), true, false, emptySet(), deferMaximise = true)
        assertEquals("new", waiting.gate.heldMaximiseId)
        val ready = stepIncomingRequest(waiting.gate, listOf("old", "new"), true, true, emptySet())
        assertEquals("new", ready.maximiseId)
        val minimised = stepIncomingRequest(waiting.gate, listOf("old", "new"), true, true, setOf("new"))
        assertNull(minimised.maximiseId)
    }

    @Test
    fun anExpiredOrDismissedHeldRequestCannotOpenButAnotherFreshRequestCan() {
        val waiting = stepIncomingRequest(IncomingRequestGate(), listOf("a", "b"), true, false, emptySet(), deferMaximise = true)
        assertEquals("a", waiting.gate.heldMaximiseId)
        assertEquals("b", stepIncomingRequest(waiting.gate, listOf("b"), true, true, emptySet()).maximiseId)
        assertEquals("b", stepIncomingRequest(waiting.gate, listOf("a", "b"), true, true, setOf("a")).maximiseId)
        assertNull(stepIncomingRequest(waiting.gate, emptyList(), true, true, emptySet()).maximiseId)
    }

    @Test
    fun aDeliberateBlockDoesNotQueueAnInterruptAfterItCloses() {
        val blocked = stepIncomingRequest(IncomingRequestGate(), listOf("a"), true, false, emptySet(), deferMaximise = false)
        assertNull(blocked.maximiseId)
        assertNull(blocked.gate.heldMaximiseId)
        assertNull(stepIncomingRequest(blocked.gate, listOf("a"), true, true, emptySet()).maximiseId)
        assertEquals("b", stepIncomingRequest(blocked.gate, listOf("a", "b"), true, true, emptySet()).maximiseId)
    }

    @Test
    fun pushRefreshWaitsForStartupAndWakesPollingImmediately() = runTest {
        val signals = Channel<Unit>(Channel.CONFLATED)
        val busy = MutableStateFlow(true)
        var calls = 0
        backgroundScope.launch {
            watchHomeRequests(signals, { busy.first { !it } }, { calls++; true })
        }
        runCurrent()
        signals.trySend(Unit)
        assertEquals(0, calls)
        busy.value = false
        runCurrent()
        // The first Home refresh also covers the push queued during startup.
        assertEquals(1, calls)
        advanceTimeBy(1_000)
        signals.trySend(Unit)
        runCurrent()
        assertEquals(2, calls)
        advanceTimeBy(20_000)
        runCurrent()
        assertEquals(3, calls)
    }

    @Test
    fun aPushDuringAnInFlightRefreshIsNotLost() = runTest {
        val signals = Channel<Unit>(Channel.CONFLATED)
        var calls = 0
        backgroundScope.launch {
            watchHomeRequests(signals, {}, { calls++; delay(100); true })
        }
        runCurrent()
        assertEquals(1, calls)
        signals.trySend(Unit)
        signals.trySend(Unit)
        advanceTimeBy(100)
        runCurrent()
        assertEquals(2, calls)
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
