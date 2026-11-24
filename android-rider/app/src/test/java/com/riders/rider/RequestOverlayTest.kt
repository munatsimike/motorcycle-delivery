package com.riders.rider

import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.RequestMapSuccess
import com.riders.rider.feature.offers.domain.RequestOverlay
import com.riders.rider.feature.offers.domain.dismissedForSettledAttempts
import com.riders.rider.feature.offers.domain.handleRequestMapSuccess
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
    fun listedAndCustomOfferSuccessCloseTheMapAndShowOneDialog() {
        val open = RequestOverlay(openId = "delivery-1")
        val listed = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent))
        val custom = handleRequestMapSuccess(open, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent))
        assertNull(listed.overlay.openId)
        assertTrue(listed.showOfferSent)
        assertFalse(listed.openDeliveries)
        assertTrue(custom.showOfferSent)
        assertFalse(handleRequestMapSuccess(listed.overlay, RequestMapEvent("delivery-1", RequestMapSuccess.OfferSent)).showOfferSent)
        assertTrue(requestMapAutoOpenBlocked(offlineConfirmation = false, offerSentVisible = true))
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
        assertFalse(requestMapAutoOpenBlocked(offlineConfirmation = false, offerSentVisible = false))
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
