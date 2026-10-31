package com.riders.rider

import com.riders.rider.feature.offers.domain.OFFER_NOTICE_BODY
import com.riders.rider.feature.offers.domain.OFFER_NOTICE_TITLE
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.notificationTapCanOpen
import com.riders.rider.feature.offers.domain.offerNotificationId
import com.riders.rider.feature.offers.domain.parseRiderOffer
import com.riders.rider.feature.offers.domain.rememberShownOffer
import com.riders.rider.feature.offers.domain.shouldAskNotificationPermission
import com.riders.rider.feature.offers.domain.shouldHoldOfferTap
import com.riders.rider.feature.auth.domain.AppEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderOfferNoticeTest {
    @Test
    fun readsADataOnlyOfferAndIgnoresAnythingElse() {
        val offer = parseRiderOffer(mapOf(
            "type" to "rider_offer",
            "assignmentId" to " assignment-1 ",
            "deliveryId" to "delivery-1",
            "expiresAt" to "2026-10-23T00:01:00.000Z",
        ))
        assertEquals("assignment-1", offer?.assignmentId)
        assertEquals("delivery-1", offer?.deliveryId)
        assertNull(parseRiderOffer(mapOf("type" to "other", "assignmentId" to "assignment-1")))
        assertNull(parseRiderOffer(mapOf("type" to "rider_offer", "assignmentId" to "assignment-1")))
    }

    @Test
    fun usesOneNotificationIdPerAssignmentAndKeepsTheLatestFifty() {
        assertEquals(offerNotificationId("assignment-1"), offerNotificationId("assignment-1"))
        assertTrue(offerNotificationId("assignment-1") >= 0)
        val first = rememberShownOffer(emptyList(), "assignment-1")
        assertEquals(listOf("assignment-1"), first)
        assertNull(rememberShownOffer(first!!, "assignment-1"))
        val existing = (1..50).map { "assignment-$it" }
        val next = rememberShownOffer(existing, "assignment-51")
        assertEquals(50, next?.size)
        assertEquals("assignment-51", next?.first())
        assertFalse(next!!.contains("assignment-50"))
    }

    @Test
    fun asksForNotificationPermissionOnceAndHoldsATapUntilHome() {
        assertTrue(shouldAskNotificationPermission(sdkInt = 33, granted = false, alreadyAsked = false))
        assertFalse(shouldAskNotificationPermission(sdkInt = 33, granted = true, alreadyAsked = false))
        assertFalse(shouldAskNotificationPermission(sdkInt = 33, granted = false, alreadyAsked = true))
        assertFalse(shouldAskNotificationPermission(sdkInt = 32, granted = false, alreadyAsked = false))
        assertTrue(shouldHoldOfferTap(AppEntry.SignedOut))
        assertFalse(shouldHoldOfferTap(AppEntry.Home))
    }

    @Test
    fun opensOnlyAListedOfferThatHasNotExpired() {
        val now = 1_700_000_000_000L
        assertFalse(notificationTapCanOpen(listed = false, expiresAt = "2026-10-23T00:01:00.000Z", nowMillis = now))
        assertFalse(notificationTapCanOpen(listed = true, expiresAt = "2020-01-01T00:00:00.000Z", nowMillis = now))
        assertTrue(notificationTapCanOpen(listed = true, expiresAt = "2099-01-01T00:00:00.000Z", nowMillis = now))
        assertEquals("New delivery request", OFFER_NOTICE_TITLE)
        assertEquals("Open the app to respond. This request expires soon.", OFFER_NOTICE_BODY)
        assertEquals("Offer no longer available", REQUEST_UNAVAILABLE)
    }
}
