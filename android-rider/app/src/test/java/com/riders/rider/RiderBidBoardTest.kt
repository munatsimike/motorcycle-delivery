package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.BidSubmissionRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.retrofit
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.BID_AMOUNT_INVALID
import com.riders.rider.feature.bids.domain.BidAttempt
import com.riders.rider.feature.bids.domain.BidBoardPhase
import com.riders.rider.feature.bids.domain.BidFailureKind
import com.riders.rider.feature.bids.domain.BidSubmitGate
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.acceptedBidNeedsRiderConfirmation
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.bidAttemptAfterRefresh
import com.riders.rider.feature.bids.domain.bidBoardPhase
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import com.riders.rider.feature.bids.domain.bidFailureKind
import com.riders.rider.feature.bids.domain.bidStatusLabel
import com.riders.rider.feature.bids.domain.formatBidDollars
import com.riders.rider.feature.bids.domain.keepsBidAttempt
import com.riders.rider.feature.bids.domain.newBidsUnavailable
import com.riders.rider.feature.bids.domain.nextBidAttempt
import com.riders.rider.feature.bids.domain.suggestedPriceLabel
import com.riders.rider.feature.bids.domain.visibleBids
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.applyAssignmentRefresh
import com.riders.rider.feature.delivery.domain.committedAssignmentsForDisplay
import com.riders.rider.feature.delivery.domain.parcelRoute
import com.riders.rider.feature.offers.domain.acceptedBidDeliveryId
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.parseRiderOffer
import com.riders.rider.feature.offers.domain.riderOfferOpensV1Offers
import com.riders.rider.navigation.deliveriesShowsBidBoard
import com.riders.rider.navigation.deliveriesShowsOffers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderBidBoardTest {
    @Test
    fun aBidAmountMustBeAPositiveUsdValue() {
        assertEquals(1250, bidAmountCents("12.50"))
        assertEquals(1250, bidAmountCents("12.5"))
        assertNull(bidAmountCents(""))
        assertNull(bidAmountCents("0"))
        assertNull(bidAmountCents("0.00"))
        assertNull(bidAmountCents("-1"))
        assertNull(bidAmountCents("12.345"))
        assertEquals(BID_AMOUNT_INVALID, "Enter a bid amount in USD.")
    }

    @Test
    fun anUncertainBidKeepsItsIdempotencyKeyAndPayload() {
        val first = nextBidAttempt(null, "delivery-1", 1500, "key-1")
        val retry = nextBidAttempt(first, "delivery-1", 1800, "key-2")
        assertEquals("key-1", retry.key)
        assertEquals(1500, retry.amountCents)
        assertEquals(first, bidAttemptAfterRefresh(first, emptyList()))
    }

    @Test
    fun aSecondTapDoesNotStartAnotherSubmission() {
        val gate = BidSubmitGate()
        assertTrue(gate.tryStart("delivery-1"))
        assertFalse(gate.tryStart("delivery-1"))
        gate.finish("delivery-1")
        assertTrue(gate.tryStart("delivery-1"))
    }

    @Test
    fun withdrawalIsOfferedOnlyForAnOpenBid() {
        assertTrue(bidCanWithdraw("OPEN"))
        assertFalse(bidCanWithdraw("ACCEPTED"))
        assertFalse(bidCanWithdraw("WITHDRAWN"))
        assertFalse(bidCanWithdraw("SUPERSEDED"))
        assertFalse(bidCanWithdraw("EXPIRED"))
        assertEquals("Open", bidStatusLabel("OPEN"))
        assertEquals("Accepted", bidStatusLabel("ACCEPTED"))
        assertEquals("Withdrawn", bidStatusLabel("WITHDRAWN"))
        assertEquals("Superseded", bidStatusLabel("SUPERSEDED"))
        assertEquals("Expired", bidStatusLabel("EXPIRED"))
    }

    @Test
    fun restartShowsTheServerBidList() {
        val server = listOf(ownBid("bid-1", "OPEN"))
        val pending = BidAttempt("delivery-1", 1000, "key-1")
        assertEquals(server, visibleBids(server, pending))
        assertNull(bidAttemptAfterRefresh(pending, server))
    }

    @Test
    fun anAcceptedBidJoinsTheAssignmentListWithoutRiderConfirmation() {
        val accepted = parcel("delivery-9", "FLEXIBLE")
        val shown = applyAssignmentRefresh(emptyList(), 1, 1, listOf(accepted))
        assertEquals("delivery-9", shown.single().deliveryId)
        assertEquals(shown, committedAssignmentsForDisplay(shown, "BUSY", true))
        assertFalse(acceptedBidNeedsRiderConfirmation())
        assertFalse(bidCanWithdraw("ACCEPTED"))
    }

    @Test
    fun expressBlocksNewBidsAndLeavesFlexibleParcelsActionable() {
        val flexible = parcel("delivery-1", "FLEXIBLE")
        val express = parcel("delivery-2", "EXPRESS")
        val live = listOf(flexible, express)
        assertTrue(newBidsUnavailable(live.map { it.serviceClass }))
        assertEquals(live, committedAssignmentsForDisplay(live, "BUSY", true))
        assertFalse(newBidsUnavailable(listOf(flexible.serviceClass)))
    }

    @Test
    fun bidSubmissionDoesNotSendAWalletCheck() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(json("""{"id":"bid-1","deliveryId":"delivery-1","amount":"12.50","amountCents":1250,"currency":"USD","status":"OPEN","createdAt":"2026-10-24T08:00:00.000Z","rider":{"id":"rider-1","name":"Rider"}}"""))
            val bids = BidRepository(server.service())
            bids.submit("delivery-1", 1250, "key-1")
            val recorded = server.takeRequest()
            assertEquals("/riders/me/bids", recorded.path)
            assertEquals("key-1", recorded.getHeader("Idempotency-Key"))
            assertEquals(
                ApiJson.encodeToString(BidSubmissionRequest("delivery-1", 1250)),
                recorded.body.readUtf8(),
            )
            assertFalse(recorded.path.orEmpty().contains("wallet"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun aLostResponseRetriesTheSameBid() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val body = """{"id":"bid-1","deliveryId":"delivery-1","amount":"12.50","amountCents":1250,"currency":"USD","status":"OPEN","createdAt":"2026-10-24T08:00:00.000Z"}"""
            server.enqueue(json(body))
            server.enqueue(json(body))
            val bids = BidRepository(server.service())
            val attempt = nextBidAttempt(null, "delivery-1", 1250, "key-1")
            bids.submit(attempt.deliveryId, attempt.amountCents, attempt.key)
            val retry = nextBidAttempt(attempt, attempt.deliveryId, 9999, "key-2")
            bids.submit(retry.deliveryId, retry.amountCents, retry.key)
            val first = server.takeRequest()
            val second = server.takeRequest()
            assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
            assertEquals(first.body.readUtf8(), second.body.readUtf8())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun withdrawalPostsToTheRiderBid() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(json("""{"id":"bid-1","deliveryId":"delivery-1","amount":"12.50","amountCents":1250,"currency":"USD","status":"WITHDRAWN","createdAt":"2026-10-24T08:00:00.000Z"}"""))
            BidRepository(server.service()).withdraw("bid-1")
            val recorded = server.takeRequest()
            assertEquals("/riders/me/bids/bid-1/withdrawal", recorded.path)
            assertEquals("POST", recorded.method)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun anAcceptedBidNoticeOpensThatDelivery() {
        val accepted = parseRiderNotice(mapOf("type" to "v2_bid_accepted", "deliveryId" to "delivery-1", "assignmentId" to "assignment-1"))
        assertEquals("delivery-1", acceptedBidDeliveryId(accepted!!))
        assertEquals("delivery/delivery-1", parcelRoute(acceptedBidDeliveryId(accepted)!!))
        assertFalse(riderOfferOpensV1Offers(accepted))
        assertNull(parseRiderOffer(mapOf("type" to "v2_bid_accepted", "deliveryId" to "delivery-1")))
    }

    @Test
    fun aRiderOfferStillOpensTheV1OfferScreen() {
        val offer = parseRiderNotice(mapOf(
            "type" to "rider_offer",
            "assignmentId" to "assignment-1",
            "deliveryId" to "delivery-1",
            "expiresAt" to "2026-10-24T08:05:00.000Z",
        ))
        assertTrue(riderOfferOpensV1Offers(offer!!))
        assertNull(acceptedBidDeliveryId(offer))
        assertFalse(deliveriesShowsBidBoard(null))
        assertTrue(deliveriesShowsOffers("AVAILABLE"))
    }

    @Test
    fun aMissedAcceptanceStillArrivesThroughTheAssignmentList() {
        val accepted = parcel("delivery-4", "FLEXIBLE")
        assertNull(parseRiderNotice(emptyMap()))
        val shown = applyAssignmentRefresh(emptyList(), 2, 2, listOf(accepted))
        assertEquals(listOf(accepted), shown)
    }

    @Test
    fun networkAndMarketplaceFailuresStayDistinct() {
        assertEquals(BidFailureKind.Network, bidFailureKind(ApiError.Network))
        assertEquals(BidFailureKind.Network, bidFailureKind(ApiError.Timeout))
        assertEquals(BidFailureKind.Authentication, bidFailureKind(ApiError.SessionEnded))
        assertEquals(BidFailureKind.MarketplaceDisabled, bidFailureKind(ApiError.Unexpected("Bidding is not available")))
        assertEquals(BidFailureKind.Request, bidFailureKind(ApiError.Conflict("The bidding window has closed")))
        assertTrue(keepsBidAttempt(ApiError.Timeout))
        assertFalse(keepsBidAttempt(ApiError.Conflict("This idempotency key was already used")))
    }

    @Test
    fun theBoardHasLoadingEmptyAndErrorStates() {
        assertEquals(BidBoardPhase.Loading, bidBoardPhase(loading = true, requestCount = 0, bidCount = 0, error = null))
        assertEquals(BidBoardPhase.Empty, bidBoardPhase(loading = false, requestCount = 0, bidCount = 0, error = null))
        assertEquals(BidBoardPhase.Failed, bidBoardPhase(loading = false, requestCount = 0, bidCount = 0, error = "Requests unavailable"))
        assertEquals(BidBoardPhase.Ready, bidBoardPhase(loading = false, requestCount = 1, bidCount = 0, error = "Try again"))
        assertNull(suggestedPriceLabel(null))
        assertEquals("Suggested price USD 9.00", suggestedPriceLabel("9.00"))
        assertEquals("10.00", formatBidDollars(1000))
    }
}

private fun ownBid(id: String, status: String) = OwnBid(
    bidId = id,
    deliveryId = "delivery-1",
    amount = "10.00",
    currency = "USD",
    status = status,
    createdAt = "2026-10-24T08:00:00.000Z",
    serviceClass = "FLEXIBLE",
    pickupAddress = "Pickup",
    dropoffAddress = "Dropoff",
    deliverBy = "2026-10-24T18:00:00.000Z",
)

private fun parcel(deliveryId: String, serviceClass: String) = CommittedParcel(
    deliveryId = deliveryId,
    assignmentId = "assignment-$deliveryId",
    status = "RIDER_ASSIGNED",
    serviceClass = serviceClass,
)

private fun MockWebServer.service(): RiderService {
    return retrofit(url("/").toString(), httpClient()).create(RiderService::class.java)
}

private fun json(body: String): MockResponse {
    return MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body)
}
