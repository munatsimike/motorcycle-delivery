package com.riders.rider

import com.riders.rider.feature.offers.domain.RiderNoticeAction
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.riderNoticeAction
import com.riders.rider.feature.offers.domain.requiresOwnBidInvalidation
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestOpportunityRefreshTest {
    @Test
    fun newOpportunityDoesNotInvalidateConfirmedBidStatus() {
        val arrival = riderNoticeAction(parseRiderNotice(mapOf(
            "type" to "rider_offer", "deliveryId" to "request-b",
            "expiresAt" to "2026-11-27T15:00:00Z",
        )))
        assertTrue(arrival is RiderNoticeAction.ShowOffer)
        assertFalse(arrival.requiresOwnBidInvalidation())
        // A renewed search also refreshes the board without globally disabling controls.
        assertFalse(RiderNoticeAction.ShowOffer("request-b", "2026-11-27T15:10:00Z").requiresOwnBidInvalidation())
    }

    @Test
    fun realBidChangesStillInvalidateStatus() {
        assertTrue(RiderNoticeAction.ShowAccepted("a").requiresOwnBidInvalidation())
        assertTrue(RiderNoticeAction.ShowBidExpired("a").requiresOwnBidInvalidation())
        assertTrue(RiderNoticeAction.ShowCustomerCancelled("a").requiresOwnBidInvalidation())
        assertFalse(RiderNoticeAction.ShowApproved("now").requiresOwnBidInvalidation())
        assertFalse(RiderNoticeAction.Ignore.requiresOwnBidInvalidation())
    }
}
