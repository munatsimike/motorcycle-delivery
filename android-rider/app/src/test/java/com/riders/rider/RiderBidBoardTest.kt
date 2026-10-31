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
import com.riders.rider.feature.bids.domain.requestDistanceLabel
import com.riders.rider.feature.bids.domain.suggestedPriceLabel
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.bids.domain.BID_LIST_UNAVAILABLE
import com.riders.rider.feature.bids.domain.MARKETPLACE_DISABLED
import com.riders.rider.feature.bids.domain.REQUEST_NO_LONGER_OPEN
import com.riders.rider.feature.bids.domain.availableRequests
import com.riders.rider.feature.bids.domain.bidListProblemMessage
import com.riders.rider.feature.bids.domain.displayedBidProblem
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.bidOutcome
import com.riders.rider.feature.bids.domain.homeAndMyOffersMatch
import com.riders.rider.feature.bids.domain.offerListStatus
import com.riders.rider.feature.bids.domain.offerServiceLabel
import com.riders.rider.feature.bids.domain.opensAcceptedDelivery
import com.riders.rider.feature.bids.domain.optimisticAmountsAfterServerRefresh
import com.riders.rider.feature.bids.domain.requestStillNeedsOffer
import com.riders.rider.feature.bids.domain.resolvedSubmittedAmount
import com.riders.rider.feature.bids.domain.viewDetailsOpensActiveDeliveries
import com.riders.rider.feature.bids.domain.visibleBids
import com.riders.rider.feature.offers.domain.bidSubmissionAfterResult
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.canStartBidSubmit
import com.riders.rider.feature.offers.domain.opensDeliveriesAfterListedOffer
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
        assertEquals("Not selected", bidStatusLabel("SUPERSEDED"))
        assertEquals("Expired", bidStatusLabel("EXPIRED"))
    }

    @Test
    fun restartShowsTheServerBidList() {
        val server = listOf(ownBid("bid-1", "OPEN"))
        val pending = BidAttempt("delivery-1", 1000, "key-1")
        assertEquals(server, visibleBids(server, pending))
        assertNull(bidAttemptAfterRefresh(pending, server))
        val now = java.time.Instant.parse("2026-10-26T12:00:00.000Z").toEpochMilli()
        val recent = ownBid("bid-2", "SUPERSEDED").copy(updatedAt = "2026-10-26T10:00:00.000Z")
        val older = ownBid("bid-3", "EXPIRED").copy(updatedAt = "2026-10-24T10:00:00.000Z")
        val open = ownBid("bid-4", "OPEN").copy(updatedAt = "2026-10-20T10:00:00.000Z")
        val shown = visibleBids(listOf(recent, older, open), null, now)
        assertEquals(listOf(recent, open), shown)
        assertEquals("Your bid was accepted.", bidOutcome("ACCEPTED"))
        assertEquals("Another rider was chosen.", bidOutcome("SUPERSEDED"))
        assertEquals("You've been selected!", bidOutcome("ACCEPTED", "EXPRESS"))
        assertEquals("Not selected — another rider was chosen.", bidOutcome("SUPERSEDED", "EXPRESS"))
        assertEquals("This offer has expired.", bidOutcome("EXPIRED"))
        assertEquals(
            "Offer sent. Waiting for the customer to choose a rider.",
            bidOutcome("OPEN", "EXPRESS", "USD", "2.99"),
        )
        assertEquals(
            "Offer sent. Waiting for the customer to choose a rider.",
            bidOutcome("OPEN", "FLEXIBLE", "USD", "4.50"),
        )
        assertEquals("Awaiting customer", bidOutcome("OPEN"))
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
    fun anExpressAssignmentDoesNotBlockNewBids() {
        val flexible = parcel("delivery-1", "FLEXIBLE")
        val express = parcel("delivery-2", "EXPRESS")
        val live = listOf(flexible, express)
        assertFalse(newBidsUnavailable(live.map { it.serviceClass }))
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
    fun aRiderOfferDoesNotOpenTheOfferInbox() {
        val offer = parseRiderNotice(mapOf(
            "type" to "rider_offer",
            "assignmentId" to "assignment-1",
            "deliveryId" to "delivery-1",
            "expiresAt" to "2026-10-24T08:05:00.000Z",
        ))
        assertFalse(riderOfferOpensV1Offers(offer!!))
        assertNull(acceptedBidDeliveryId(offer))
        assertFalse(deliveriesShowsBidBoard(null))
        assertFalse(deliveriesShowsOffers("AVAILABLE"))
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
        assertNull(requestDistanceLabel(null))
        assertEquals("Distance 800 m", requestDistanceLabel(800))
        assertEquals("Distance 12.4 km", requestDistanceLabel(12400))
        assertEquals("10.00", formatBidDollars(1000))
    }

    @Test
    fun homeAndMyOffersShareTheServerBid() {
        val listed = bidSubmissionAfterResult("2.99", null)
        val custom = bidSubmissionAfterResult("4.50", null)
        val interest = bidSubmissionAfterResult("2.99", null)
        val failed = bidSubmissionAfterResult("2.99", "This delivery is not open for bids")
        assertEquals("2.99", listed.amount)
        assertEquals("4.50", custom.amount)
        assertEquals("2.99", interest.amount)
        assertNull(failed.amount)
        assertEquals("This delivery is not open for bids", failed.error)
        assertTrue(requestStillNeedsOffer("delivery-1", emptyList(), emptyMap()))
        assertFalse(canStartBidSubmit(submittingBid = true, accepting = false))
        assertTrue(canStartBidSubmit(submittingBid = false, accepting = false))

        val server = listOf(ownBid("bid-1", "OPEN").copy(amount = "2.99"))
        assertEquals("2.99", resolvedSubmittedAmount(server, "delivery-1", optimistic = null))
        assertEquals("4.50", resolvedSubmittedAmount(emptyList(), "delivery-1", "4.50"))
        assertEquals(emptyMap<String, String>(), optimisticAmountsAfterServerRefresh(mapOf("delivery-1" to "2.99"), server))
        assertFalse(requestStillNeedsOffer("delivery-1", server))
        assertTrue(homeAndMyOffersMatch(server.first(), server.first()))
        assertFalse(viewDetailsOpensActiveDeliveries("OPEN"))
        assertFalse(viewDetailsOpensActiveDeliveries(null))
        assertFalse(viewDetailsOpensActiveDeliveries("ACCEPTED"))
        assertFalse(opensAcceptedDelivery("ACCEPTED"))
        assertFalse(opensAcceptedDelivery("OPEN"))
        assertEquals("Accepted", offerListStatus("ACCEPTED"))
        assertEquals("Not selected", offerListStatus("SUPERSEDED"))
        assertEquals("Waiting", offerListStatus("OPEN"))
        assertEquals("Urgent", offerServiceLabel("EXPRESS"))
        assertEquals("Flexible", offerServiceLabel("FLEXIBLE"))
        assertTrue(opensDeliveriesAfterListedOffer(null))
        assertFalse(opensDeliveriesAfterListedOffer("FLEXIBLE"))
        assertFalse(opensDeliveriesAfterListedOffer("EXPRESS"))

        val request = OpenBidRequest(
            id = "delivery-9",
            serviceClass = "FLEXIBLE",
            deliverBy = "2026-10-28T12:00:00Z",
            suggestedPrice = "3.00",
            pickupAddress = "Pickup",
            dropoffAddress = "Drop-off",
            parcelDescription = "Parcel",
            parcelSize = "Small",
            distanceMeters = 800,
            currency = "USD",
        )
        val shown = availableRequests(emptyList(), listOf(request))
        assertEquals("delivery-9", shown.single().deliveryId)
        assertEquals("request:delivery-9", shown.single().assignmentId)
        assertEquals("2026-10-28T12:00:00Z", shown.single().expiresAt)
        assertEquals("3.00", shown.single().offeredPrice)
        val customerPriced = availableRequests(emptyList(), listOf(request.copy(offeredPrice = "4.50"))).single()
        assertEquals("4.50", customerPriced.offeredPrice)
        assertEquals("USD", shown.single().currency)

        val legacy = sampleOffer(assignmentId = "assignment-1", deliveryId = "legacy-1", expiresAt = "2026-10-27T12:05:00Z", serviceClass = null)
        val classed = sampleOffer(assignmentId = "assignment-2", deliveryId = "classed-1", expiresAt = "2026-10-27T12:05:00Z", serviceClass = "FLEXIBLE")
        val merged = availableRequests(listOf(legacy, classed), listOf(request, request.copy(id = "legacy-1")))
        assertEquals(listOf("delivery-9", "legacy-1"), merged.map { it.deliveryId })
        assertTrue(merged.all { it.assignmentId.startsWith("request:") })
        assertTrue(merged.none { it.assignmentId == "assignment-1" || it.assignmentId == "assignment-2" })
        val openEnded = availableRequests(emptyList(), listOf(request.copy(deliverBy = null))).single()
        assertEquals("delivery-9", openEnded.deliveryId)
        assertEquals("", openEnded.expiresAt)
        assertEquals("3.00", openEnded.offeredPrice)
        assertTrue(canAcceptOffer(openEnded.expiresAt, System.currentTimeMillis(), accepting = false, unavailable = false))

        assertFalse(marketplaceBidButtonsVisible("FLEXIBLE", ownBidsKnown = false, failure = null))
        assertFalse(marketplaceBidButtonsVisible("EXPRESS", ownBidsKnown = true, failure = MARKETPLACE_DISABLED))
        assertFalse(marketplaceBidButtonsVisible("FLEXIBLE", ownBidsKnown = true, failure = "This delivery is not open for bids"))
        assertTrue(marketplaceBidButtonsVisible("FLEXIBLE", ownBidsKnown = true, failure = "Network request failed. Check your connection and try again."))
        assertTrue(marketplaceBidButtonsVisible(null, ownBidsKnown = false, failure = MARKETPLACE_DISABLED))
        assertEquals(MARKETPLACE_DISABLED, bidListProblemMessage(ApiError.Unexpected(MARKETPLACE_DISABLED)))
        assertEquals(BID_LIST_UNAVAILABLE, bidListProblemMessage(ApiError.Network))
        assertEquals(REQUEST_NO_LONGER_OPEN, displayedBidProblem(true, null, "The bidding window has closed"))
        assertEquals(MARKETPLACE_DISABLED, displayedBidProblem(true, MARKETPLACE_DISABLED, null))
        assertEquals(null, displayedBidProblem(false, MARKETPLACE_DISABLED, null))
        assertEquals("2.99", resolvedSubmittedAmount(server, "delivery-1", optimistic = null))
    }
}

private fun sampleOffer(assignmentId: String, deliveryId: String, expiresAt: String, serviceClass: String?): OfferResponse {
    return OfferResponse(
        assignmentId = assignmentId,
        deliveryId = deliveryId,
        expiresAt = expiresAt,
        offeredPrice = "2.99",
        currency = "USD",
        payer = "SENDER",
        paymentMethod = "CASH",
        parcel = ParcelResponse("Parcel", "Small"),
        pickup = StopResponse("Pickup", contactName = "", contactPhone = ""),
        dropoff = StopResponse("Drop-off", contactName = "", contactPhone = ""),
        serviceClass = serviceClass,
    )
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
