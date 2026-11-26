package com.riders.rider

import com.riders.rider.feature.bids.data.OwnBidPage
import com.riders.rider.feature.bids.data.mergeOwnBidPage
import com.riders.rider.feature.bids.data.requestBidCoverageNeeded
import com.riders.rider.feature.bids.domain.*
import com.riders.rider.feature.delivery.data.AssignmentListStore
import com.riders.rider.feature.delivery.domain.CommittedParcel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class RiderAuditRegressionTest {
    private fun bid(id: String, created: String, status: String = "OPEN") = OwnBid(
        id, "delivery-$id", "10.00", "USD", status, created,
        serviceClass = "FLEXIBLE", pickupAddress = "A", dropoffAddress = "B", deliverBy = null,
    )
    private fun request(start: String?) = OpenBidRequest("delivery-x", "FLEXIBLE", null,
        searchStartedAt = start, suggestedPrice = "10.00", pickupAddress = "A", dropoffAddress = "B",
        parcelDescription = "Parcel", parcelSize = "Small")

    @Test fun changedRetryAmountIsBlockedWithoutChangingIdempotencyKey() {
        val attempt = nextBidAttempt(null, "delivery-x", 1000, "original")
        val retry = nextBidAttempt(attempt, "delivery-x", 1500, "new")
        assertEquals(attempt, retry)
        assertTrue(bidRetryAmountProblem(retry, 1500).orEmpty().contains("10.00"))
        assertNull(bidRetryAmountProblem(retry, 1000))
        assertEquals("10.00", formatBidDollars(retry.amountCents))
        assertNull(bidAmountCents("9223372036854775807"))
    }
    @Test fun coverageStopsAfterPassingSearchStartButNotBefore() {
        val start = "2026-11-26T10:00:00Z"
        assertTrue(requestBidCoverageNeeded(listOf(request(start)), listOf(bid("a", "2026-11-26T10:01:00Z"))))
        assertFalse(requestBidCoverageNeeded(listOf(request(start)), listOf(bid("a", "2026-11-26T09:59:00Z"))))
        assertTrue(requestBidCoverageNeeded(listOf(request(null)), listOf(bid("a", "2026-11-26T09:59:00Z"))))
        assertFalse(requestBidCoverageNeeded(listOf(request(start)), listOf(bid("x", "2026-11-26T10:01:00Z"))))
    }
    @Test fun freshHeadRetainsOlderLoadedRowsAndCursor() {
        val older = bid("b", "2026-11-26T09:00:00Z", "EXPIRED")
        val old = OwnBidPage(listOf(bid("a", "2026-11-26T10:00:00Z"), older), "older")
        val head = OwnBidPage(listOf(bid("a", "2026-11-26T10:00:00Z", "ACCEPTED")), "head")
        assertEquals(OwnBidPage(head.bids + older, "older"), mergeOwnBidPage(old, head, null))
        assertEquals(head.copy(nextCursor = null), mergeOwnBidPage(old, head.copy(nextCursor = null), null))
    }
    @Test fun staleAssignmentResponseCannotConfirmAfterMutationOrSignOut() {
        val store = AssignmentListStore()
        val revision = store.readRevision()
        val token = store.beginIfRevision(revision)!!
        store.invalidateRead()
        assertNull(store.beginIfRevision(revision))
        store.confirm(token, listOf(CommittedParcel("delivery-x", "assignment-x", "RIDER_ASSIGNED")))
        assertFalse(store.isCurrentRefresh(token))
        assertTrue(store.current().isEmpty())
        val fresh = store.beginIfRevision(store.readRevision())!!
        store.confirm(fresh, listOf(CommittedParcel("delivery-y", "assignment-y", "RIDER_ASSIGNED")))
        assertTrue(store.isCurrentRefresh(fresh))
        store.clearSession()
        store.confirm(fresh, listOf(CommittedParcel("delivery-y", "assignment-y", "RIDER_ASSIGNED")))
        assertFalse(store.isCurrentRefresh(fresh))
        assertTrue(store.current().isEmpty())
    }
}
