package com.riders.rider

import com.riders.rider.feature.offers.domain.acceptedBidTapDeliveryId
import com.riders.rider.feature.offers.domain.acceptedDeliveryAlreadyOpen
import com.riders.rider.feature.offers.domain.OFFER_NOTICE_BODY
import com.riders.rider.feature.offers.domain.OFFER_NOTICE_TITLE
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.notificationRequestCanOpen
import com.riders.rider.feature.offers.domain.notificationTapCanOpen
import com.riders.rider.feature.offers.domain.offerAttemptKey
import com.riders.rider.feature.offers.domain.offerNotificationId
import com.riders.rider.feature.offers.domain.CUSTOMER_CANCELLED_BODY
import com.riders.rider.feature.offers.domain.RiderNoticeAction
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.parseRiderOffer
import com.riders.rider.feature.offers.domain.riderNoticeAction
import com.riders.rider.feature.offers.domain.rememberShownOffer
import com.riders.rider.feature.offers.domain.shouldAskNotificationPermission
import com.riders.rider.feature.offers.domain.shouldHoldOfferTap
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.offers.notification.PendingOffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderOfferNoticeTest {
    @Test
    fun acceptedNotificationTapRecognisesBothAppAndFirebaseExtras() {
        assertEquals("delivery-1", acceptedBidTapDeliveryId(" delivery-1 ", null, null))
        assertEquals("delivery-2", acceptedBidTapDeliveryId(null, "v2_bid_accepted", " delivery-2 "))
        assertEquals("delivery-2", acceptedBidTapDeliveryId(" ", "v2_bid_accepted", "delivery-2"))
        assertEquals("delivery-1", acceptedBidTapDeliveryId("delivery-1", "v2_bid_accepted", "delivery-2"))
    }

    @Test
    fun acceptedTapRejectsMissingIdsAndUnrelatedNotifications() {
        assertNull(acceptedBidTapDeliveryId(null, "v2_bid_accepted", null))
        assertNull(acceptedBidTapDeliveryId(null, "v2_bid_accepted", " "))
        assertNull(acceptedBidTapDeliveryId(null, "rider_offer", "delivery-1"))
        assertNull(acceptedBidTapDeliveryId(null, "v2_customer_cancelled", "delivery-1"))
        assertNull(acceptedBidTapDeliveryId(null, null, "delivery-1"))
    }

    @Test
    fun acceptedTapDoesNotDuplicateTheSameActiveDeliveryPage() {
        assertTrue(acceptedDeliveryAlreadyOpen("delivery-1", "delivery-1", false))
        assertFalse(acceptedDeliveryAlreadyOpen("delivery-1", null, false))
        assertFalse(acceptedDeliveryAlreadyOpen("delivery-1", "delivery-2", false))
        assertFalse(acceptedDeliveryAlreadyOpen("delivery-1", "delivery-1", true))
    }

    @Test
    fun acceptedTapIsRetainedUntilAcknowledgedAndCannotClearANewerTap() {
        val pending = PendingOffer()
        pending.acceptedBidArrived("delivery-0")
        assertNull(pending.acceptedTaps.value)
        pending.acceptedBidTapped("delivery-1")
        assertEquals("delivery-1", pending.acceptedTaps.value)
        pending.acceptedBidTapped("delivery-2")
        pending.acknowledgeAcceptedTap("delivery-1")
        assertEquals("delivery-2", pending.acceptedTaps.value)
        pending.acknowledgeAcceptedTap("delivery-2")
        assertNull(pending.acceptedTaps.value)
    }

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
        assertTrue(notificationRequestCanOpen(listed = true, expiresAt = null, nowMillis = now))
        assertFalse(notificationRequestCanOpen(listed = true, expiresAt = "2020-01-01T00:00:00.000Z", nowMillis = now))
        assertEquals("New delivery request", OFFER_NOTICE_TITLE)
        assertEquals("Open the app to respond. This request expires soon.", OFFER_NOTICE_BODY)
        assertEquals("Offer no longer available", REQUEST_UNAVAILABLE)
    }

    @Test
    fun readsExpiryNoticeOnlyWithDeliveryId() {
        assertEquals(RiderNoticeAction.ShowBidExpired("delivery-9"), riderNoticeAction(parseRiderNotice(mapOf(
            "type" to "v2_bid_expired", "deliveryId" to " delivery-9 ",
        ))))
        assertNull(parseRiderNotice(mapOf("type" to "v2_bid_expired")))
        assertNull(parseRiderNotice(mapOf("type" to "v2_bid_expired", "deliveryId" to " ")))
    }

    @Test
    fun showsACustomerCancellationForTheAssignedDeliveryAndIgnoresOtherTypes() {
        val notice = parseRiderNotice(mapOf(
            "type" to "v2_customer_cancelled",
            "deliveryId" to " delivery-9 ",
        ))
        assertEquals(RiderNoticeAction.ShowCustomerCancelled("delivery-9"), riderNoticeAction(notice))
        assertEquals(RiderNoticeAction.Ignore, riderNoticeAction(parseRiderNotice(mapOf(
            "type" to "v2_rider_cancelled",
            "deliveryId" to "delivery-9",
        ))))
        assertEquals(RiderNoticeAction.Ignore, riderNoticeAction(parseRiderNotice(mapOf("type" to "unknown"))))
        assertEquals(RiderNoticeAction.Ignore, riderNoticeAction(null))
        assertEquals("The customer cancelled the delivery.", CUSTOMER_CANCELLED_BODY)
    }

    @Test
    fun aNewSearchAttemptForTheSameDeliveryShowsAgain() {
        val firstAttempt = offerAttemptKey("delivery-1", "2026-10-28T11:06:00.000Z")
        val shown = rememberShownOffer(emptyList(), firstAttempt)
        assertEquals(listOf(firstAttempt), shown)
        assertNull(rememberShownOffer(shown!!, offerAttemptKey(" delivery-1 ", "2026-10-28T11:06:00.000Z")))
        val renewed = rememberShownOffer(shown, offerAttemptKey("delivery-1", "2026-10-28T12:06:00.000Z"))
        assertEquals(offerAttemptKey("delivery-1", "2026-10-28T12:06:00.000Z"), renewed?.first())
        val blank = offerAttemptKey("delivery-1", "  ")
        assertEquals("offer:delivery-1:", blank)
        assertEquals(blank, offerAttemptKey("delivery-1", null))
        assertEquals("offer:delivery-1:not-a-date", offerAttemptKey("delivery-1", "not-a-date"))
        val blankShown = rememberShownOffer(emptyList(), blank)
        assertNull(rememberShownOffer(blankShown!!, offerAttemptKey("delivery-1", null)))
        val action = riderNoticeAction(parseRiderNotice(mapOf(
            "type" to "rider_offer",
            "deliveryId" to "delivery-1",
            "expiresAt" to "2026-10-28T11:06:00.000Z",
        )))
        assertEquals(RiderNoticeAction.ShowOffer("delivery-1", "2026-10-28T11:06:00.000Z"), action)
        assertEquals(offerNotificationId("delivery-1"), offerNotificationId("delivery-1"))
        assertTrue(notificationTapCanOpen(listed = true, expiresAt = "2026-10-28T12:06:00.000Z", nowMillis = 1_700_000_000_000L))
    }
}
