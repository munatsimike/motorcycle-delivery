package com.riders.rider

import com.riders.rider.feature.bids.data.OwnBidPage
import com.riders.rider.feature.bids.data.mergeOwnBidPage
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.availableRequests
import com.riders.rider.feature.bids.domain.newMarketplaceOffers
import com.riders.rider.feature.offers.domain.requestAttemptIdentity
import com.riders.rider.feature.offers.domain.retainActionableRequests
import com.riders.rider.feature.offers.domain.searchAttemptKey
import com.riders.rider.feature.offers.domain.withoutSettledRequests
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class SharedRequestListsTest {
    private fun bid(id: String, status: String = "OPEN") = OwnBid(
        id, "delivery-$id", "5.00", "USD", status, "2026-11-26T10:00:00Z",
        serviceClass = "FLEXIBLE", pickupAddress = "A", dropoffAddress = "B", deliverBy = null,
    )

    private fun request(start: String) = availableRequests(emptyList(), listOf(OpenBidRequest(
        id = "delivery-a", serviceClass = "FLEXIBLE", deliverBy = null, searchStartedAt = start,
        suggestedPrice = "5.00", pickupAddress = "A", dropoffAddress = "B",
        parcelDescription = "Parcel", parcelSize = "Small",
    ))).single()

    @Test fun settledAttemptIsRemovedFromEveryProjectionAndRenewalIsAllowed() {
        val first = request("2026-11-26T10:00:00Z")
        val renewed = request("2026-11-26T10:10:00Z")
        val settled = setOf(searchAttemptKey(first.deliveryId, first.searchExpiresAt))
        val shared = withoutSettledRequests(listOf(first), settled)
        assertTrue(shared.isEmpty())
        assertTrue(newMarketplaceOffers(shared, emptyList()).isEmpty())
        assertEquals(listOf(renewed), withoutSettledRequests(listOf(renewed), settled))
    }

    @Test fun expiredAttemptCannotReturnFromStaleRefresh() {
        val first = request("2026-11-26T10:00:00Z")
        val renewed = request("2026-11-26T10:10:00Z")
        val now = Instant.parse("2026-11-26T10:06:04Z").toEpochMilli()
        val retired = retainActionableRequests(listOf(first), emptyMap(), emptySet(), now)
        assertTrue(retired.offers.isEmpty())
        assertTrue(requestAttemptIdentity(first) in retired.retired)
        assertTrue(retainActionableRequests(listOf(first), retired.seenAt, retired.retired, now).offers.isEmpty())
        assertEquals(listOf(renewed), retainActionableRequests(listOf(renewed), retired.seenAt, retired.retired, now).offers)
    }

    @Test fun paginationMergesByBidIdAndUsesNewestStatus() {
        val first = OwnBidPage(listOf(bid("a"), bid("b")), "next")
        val page = OwnBidPage(listOf(bid("b", "EXPIRED"), bid("c")), null)
        val merged = mergeOwnBidPage(first, page, "next")
        assertEquals(listOf("a", "b", "c"), merged.bids.map { it.bidId })
        assertEquals("EXPIRED", merged.bids[1].status)
        assertNull(merged.nextCursor)
    }

    @Test fun stalePageCannotOverwriteRefreshedCursor() {
        val current = OwnBidPage(listOf(bid("a", "ACCEPTED")), "new")
        val old = OwnBidPage(listOf(bid("a"), bid("b")), null)
        assertEquals(current, mergeOwnBidPage(current, old, "old"))
    }

    @Test fun firstPageRefreshPreservesOlderLoadedHistory() {
        val older = bid("b", "EXPIRED").copy(createdAt = "2026-11-26T09:00:00Z")
        val previous = OwnBidPage(listOf(bid("a"), older), "old")
        val current = OwnBidPage(listOf(bid("a", "WITHDRAWN")), "new")
        assertEquals(OwnBidPage(current.bids + older, "old"), mergeOwnBidPage(previous, current, null))
    }
}
