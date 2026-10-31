package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.LiveAssignmentsResponse
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.network.text
import com.riders.rider.feature.home.AvailabilityChange
import com.riders.rider.feature.home.beginAvailabilityChange
import com.riders.rider.feature.home.confirmAvailability
import com.riders.rider.feature.home.failAvailability
import com.riders.rider.feature.home.DashboardFailure
import com.riders.rider.feature.home.dashboardFailure
import com.riders.rider.feature.home.activeDeliveryCount
import com.riders.rider.feature.home.homeShift
import com.riders.rider.feature.home.OFFLINE_WITH_DELIVERIES_MESSAGE
import com.riders.rider.feature.home.offlineConfirmationRequired
import com.riders.rider.feature.home.ReceivingAlignment
import com.riders.rider.feature.home.homeWalletAmount
import com.riders.rider.feature.home.receivingAfterRefresh
import com.riders.rider.feature.home.receivingAlignment
import com.riders.rider.feature.home.showsReceivingControl
import com.riders.rider.feature.home.showsV1ActiveDelivery
import com.riders.rider.feature.home.workloadCounts
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.OFFER_CLOCK_INTERVAL_MS
import com.riders.rider.feature.offers.domain.OFFER_REFRESH_INTERVAL_MS
import com.riders.rider.feature.offers.domain.OFFER_UNAVAILABLE
import com.riders.rider.feature.offers.domain.OfferRefreshGate
import com.riders.rider.feature.offers.domain.OfferWatch
import com.riders.rider.feature.offers.domain.adjustedNowMillis
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.clockOffsetMillis
import com.riders.rider.feature.offers.domain.httpDateMillis
import com.riders.rider.feature.offers.domain.matchingOfferIndex
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.AWAITING_CUSTOMER
import com.riders.rider.feature.offers.domain.OFFER_YOUR_PRICE
import com.riders.rider.feature.offers.domain.acceptOfferLabel
import com.riders.rider.feature.offers.domain.bidSubmissionAfterResult
import com.riders.rider.feature.offers.domain.canStartBidSubmit
import com.riders.rider.feature.offers.domain.deliveryCategoryTitle
import com.riders.rider.feature.offers.domain.offerPriceLabel
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.opensDeliveriesAfterListedOffer
import com.riders.rider.feature.offers.domain.requestNeedsAnotherOffer
import com.riders.rider.feature.offers.domain.sentOffersAfterRefresh
import com.riders.rider.feature.offers.domain.submittedOfferAmount
import com.riders.rider.feature.offers.domain.offerStopLine
import com.riders.rider.feature.offers.domain.offerUnavailableAfterRefresh
import com.riders.rider.feature.offers.domain.shouldPollOffers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.riderReadiness
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderDashboardTest {
    @Test
    fun receivingFollowsOnlineAndOfflineWithoutASeparateToggle() {
        assertFalse(showsReceivingControl())
        assertEquals(ReceivingAlignment.Enable, receivingAlignment("AVAILABLE", false))
        assertEquals(ReceivingAlignment.Disable, receivingAlignment("OFFLINE", true))
        assertEquals(ReceivingAlignment.None, receivingAlignment("AVAILABLE", true))
        assertEquals(ReceivingAlignment.None, receivingAlignment("OFFLINE", false))
        assertEquals(ReceivingAlignment.ReleaseBusy, receivingAlignment("BUSY", true))
        assertEquals(ReceivingAlignment.ReleaseBusy, receivingAlignment("BUSY", false))
        assertEquals(ReceivingAlignment.None, receivingAlignment("BUSY", null))
        assertEquals(ReceivingAlignment.None, receivingAlignment("AVAILABLE", null))
        val stale = homeShift("BUSY", canAcceptDeliveries = true, active = null, marketplace = true)
        assertTrue(stale.showGoOnline)
        assertFalse(stale.showGoOffline)
        assertFalse(stale.recoveryRequired)
        assertNull(stale.recoveryMessage)
        val marketplaceBusy = riderReadiness(sample("APPROVED", "VERIFIED", true, "BUSY").copy(receiving = true))
        assertTrue(marketplaceBusy.canGoOnline)
        assertEquals("Offline", marketplaceBusy.availabilityLabel)
    }

    @Test
    fun availabilityStaysOfflineUntilTheBackendConfirmsIt() {
        val offline = AvailabilityChange(availability = "OFFLINE")
        val started = beginAvailabilityChange(offline)
        assertEquals(true, started?.changing)
        assertEquals("OFFLINE", started?.availability)
        val confirmed = confirmAvailability(started!!, "AVAILABLE", null)
        assertEquals("AVAILABLE", confirmed.availability)
        assertFalse(confirmed.changing)
        val rejected = failAvailability(started, "Rider approval is required")
        assertEquals("OFFLINE", rejected.availability)
        assertEquals("Rider approval is required", rejected.error)
    }

    @Test
    fun offlineWithActiveDeliveriesAsksBeforeStoppingNewRequests() {
        assertFalse(offlineConfirmationRequired(activeDeliveryCount(showActiveDelivery = false, flexibleCount = 0, expressCount = 0)))
        assertTrue(offlineConfirmationRequired(activeDeliveryCount(showActiveDelivery = true, flexibleCount = null, expressCount = null)))
        assertEquals(3, activeDeliveryCount(showActiveDelivery = true, flexibleCount = 2, expressCount = 1))
        assertTrue(OFFLINE_WITH_DELIVERIES_MESSAGE.contains("stay assigned to you"))
    }

    @Test
    fun aSecondAvailabilityTapIsIgnored() {
        val changing = AvailabilityChange(availability = "OFFLINE", changing = true)
        assertNull(beginAvailabilityChange(changing))
    }

    @Test
    fun revokedReadinessCannotGoOnlineOrReceiveRequests() {
        val revoked = riderReadiness(sample(approval = "SUSPENDED", licence = "REJECTED", motorcycle = false, availability = "AVAILABLE"))
        assertFalse(revoked.canGoOnline)
        assertFalse(revoked.canAcceptDeliveries)
        assertEquals("Offline", revoked.availabilityLabel)
        val shift = homeShift("AVAILABLE", revoked.canAcceptDeliveries, null)
        assertFalse(shift.showOffers)
        assertFalse(shift.showGoOnline)
        val busy = homeShift("BUSY", canAcceptDeliveries = false, active = null)
        assertFalse(busy.showGoOnline)
        assertFalse(busy.showGoOffline)
    }

    @Test
    fun sessionExpiryAndAvailabilityConflictsUseTheServerOutcome() {
        assertEquals(
            "Your session has ended. Sign in again.",
            mapHttpFailure(401, """{"message":"Authentication failed"}""").text(),
        )
        assertEquals("Rider access is required.", mapHttpFailure(403, """{"message":"Rider access is required"}""").text())
        assertEquals(
            "Availability cannot be changed while busy",
            mapHttpFailure(409, """{"message":"Availability cannot be changed while busy"}""").text(),
        )
        assertEquals(
            "This offer has expired",
            mapHttpFailure(409, """{"message":"This offer has expired"}""").text(),
        )
    }

    @Test
    fun anEmptyOfferListClearsThePreviousError() {
        val loaded = offerBoardAfterLoad(OfferBoard(count = 2, error = "Network request failed. Check your connection and try again."), 0, null)
        assertEquals(0, loaded.count)
        assertNull(loaded.error)
        assertFalse(loaded.loading)
    }

    @Test
    fun aFailedOfferRefreshKeepsTheOffersAlreadyShown() {
        val failed = offerBoardAfterLoad(
            OfferBoard(count = 1),
            null,
            ApiError.Network.text(),
        )
        assertEquals(1, failed.count)
        assertEquals("Network request failed. Check your connection and try again.", failed.error)
    }

    @Test
    fun offerExpiryIsDerivedFromTheBackendTimestamp() {
        val expiresAt = "2026-10-20T12:01:00Z"
        val before = java.time.Instant.parse("2026-10-20T12:00:30Z").toEpochMilli()
        val after = java.time.Instant.parse("2026-10-20T12:01:00Z").toEpochMilli()
        assertFalse(offerIsExpired(expiresAt, before))
        assertTrue(offerIsExpired(expiresAt, after))
        assertEquals("Expired", offerExpiryLabel(expiresAt, after))
        assertEquals("0:30", offerExpiryLabel(expiresAt, before))
        assertTrue(canAcceptOffer(expiresAt, before, accepting = false, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, after, accepting = false, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, before, accepting = true, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, before, accepting = false, unavailable = true))
    }

    @Test
    fun offeredPriceShowsCurrencyWithoutCallingItEarnings() {
        val label = offerPriceLabel("USD", "2.00")
        assertEquals("USD 2.00", label)
        assertEquals("Accept for $2.98", acceptOfferLabel("USD", "2.98"))
        assertEquals("Your offer", OFFER_YOUR_PRICE)
        assertEquals("Awaiting customer", AWAITING_CUSTOMER)
        assertEquals("Parcel delivery", deliveryCategoryTitle("Parcel"))
        assertEquals("Food delivery", deliveryCategoryTitle("food"))
        assertEquals("Doc delivery", deliveryCategoryTitle("document"))
        assertFalse(label.contains("earning", ignoreCase = true))
    }

    @Test
    fun aSentOfferStaysOnTheRequestAndNamesTheSubmittedAmount() {
        assertEquals(
            "Offer sent. Waiting for the customer to choose a rider.",
            offerSentConfirmation("USD", "2.99"),
        )
        assertEquals(
            "Offer sent. Waiting for the customer to choose a rider.",
            offerSentConfirmation("USD", "4.50"),
        )
        val sent = bidSubmissionAfterResult("4.50", null)
        assertFalse(sent.submitting)
        assertEquals("4.50", sent.amount)
        assertNull(sent.error)
    }

    @Test
    fun aFailedOfferKeepsTheBiddingActions() {
        val failed = bidSubmissionAfterResult("2.99", "This delivery is not open for bids")
        assertFalse(failed.submitting)
        assertNull(failed.amount)
        assertEquals("This delivery is not open for bids", failed.error)
        assertTrue(requestNeedsAnotherOffer("delivery-1", emptyMap()))
    }

    @Test
    fun aSecondTapDoesNotStartAnotherBid() {
        assertTrue(canStartBidSubmit(submittingBid = false, accepting = false))
        assertFalse(canStartBidSubmit(submittingBid = true, accepting = false))
        assertFalse(canStartBidSubmit(submittingBid = false, accepting = true))
    }

    @Test
    fun expressAndFlexibleOffersStayOnTheRequestAfterRefresh() {
        assertFalse(opensDeliveriesAfterListedOffer("EXPRESS"))
        assertFalse(opensDeliveriesAfterListedOffer("FLEXIBLE"))
        assertTrue(opensDeliveriesAfterListedOffer(null))
        val sent = mapOf("delivery-1" to "2.99")
        val refreshed = sentOffersAfterRefresh(sent)
        assertEquals(sent, refreshed)
        assertEquals("2.99", submittedOfferAmount(refreshed, "delivery-1"))
        assertFalse(requestNeedsAnotherOffer("delivery-1", refreshed))
        assertTrue(requestNeedsAnotherOffer("delivery-2", refreshed))
    }

    @Test
    fun offerStopOmitsALandmarkThatRepeatsTheAddress() {
        val address = "45 Parklaan, Haarlem Netherlands"
        assertEquals(address, offerStopLine(address, address))
        assertEquals(address, offerStopLine(address, "haarlem netherlands"))
        assertEquals("1Z Generaal Joubertstraat, Haarlem", offerStopLine("1Z Generaal Joubertstraat, Haarlem", null))
        assertEquals("$address, blue gate", offerStopLine(address, "blue gate"))
    }

    @Test
    fun aMissingOfferIsReportedOnlyAfterASuccessfulRefresh() {
        assertTrue(offerUnavailableAfterRefresh(hadSelection = true, stillPresent = false, refreshSucceeded = true))
        assertFalse(offerUnavailableAfterRefresh(hadSelection = true, stillPresent = false, refreshSucceeded = false))
        assertFalse(offerUnavailableAfterRefresh(hadSelection = false, stillPresent = false, refreshSucceeded = true))
        assertFalse(offerUnavailableAfterRefresh(hadSelection = true, stillPresent = true, refreshSucceeded = true))
        assertEquals("This offer is no longer available.", OFFER_UNAVAILABLE)
    }

    @Test
    fun aRefreshedOfferForTheSameDeliveryStaysOpen() {
        assertEquals(0, matchingOfferIndex("old-offer", "delivery-1", listOf("new-offer"), listOf("delivery-1")))
        assertEquals(1, matchingOfferIndex("old-offer", "delivery-1", listOf("other-offer", "new-offer"), listOf("delivery-2", "delivery-1")))
        assertEquals(0, matchingOfferIndex("same-offer", "delivery-1", listOf("same-offer"), listOf("delivery-1")))
        assertEquals(-1, matchingOfferIndex("old-offer", "delivery-1", listOf("other-offer"), listOf("delivery-2")))
    }

    @Test
    fun theOfferClockUsesTheResponseDateWhenTheServerSendsOne() {
        val server = java.time.Instant.parse("2026-10-20T12:00:00Z").toEpochMilli()
        val device = java.time.Instant.parse("2026-10-20T12:00:05Z").toEpochMilli()
        val offset = clockOffsetMillis(server, device)
        assertEquals(-5_000L, offset)
        assertEquals(server, adjustedNowMillis(device, offset))
        assertEquals(0L, clockOffsetMillis(null, device))
        assertEquals(server, httpDateMillis("Tue, 20 Oct 2026 12:00:00 GMT"))
        assertNull(httpDateMillis("not-a-date"))
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun offersRefreshOnlyWhileTheScreenIsResumedAndStopWhenItLeaves() = runTest {
        assertTrue(shouldPollOffers(true))
        assertFalse(shouldPollOffers(false))
        assertEquals(20_000L, OFFER_REFRESH_INTERVAL_MS)
        assertEquals(1_000L, OFFER_CLOCK_INTERVAL_MS)
        var refreshes = 0
        var ticks = 0
        val watch = OfferWatch(backgroundScope, refresh = { refreshes += 1 }, tick = { ticks += 1 })
        watch.setResumed(true)
        watch.setResumed(true)
        runCurrent()
        assertEquals(1, refreshes)
        assertTrue(ticks >= 1)
        advanceTimeBy(OFFER_REFRESH_INTERVAL_MS)
        runCurrent()
        assertEquals(2, refreshes)
        val ticksWhileOpen = ticks
        assertTrue(ticksWhileOpen > 1)
        watch.setResumed(false)
        runCurrent()
        assertFalse(watch.running)
        advanceTimeBy(OFFER_REFRESH_INTERVAL_MS)
        runCurrent()
        assertEquals(2, refreshes)
        assertEquals(ticksWhileOpen, ticks)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun aRefreshAlreadyInFlightIsNotStartedAgain() = runTest {
        val gate = OfferRefreshGate()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var running = 0
        var peak = 0
        val first = launch {
            gate.run {
                running += 1
                peak = maxOf(peak, running)
                started.complete(Unit)
                release.await()
                running -= 1
            }
        }
        started.await()
        var secondEntered = false
        val second = launch {
            gate.run {
                secondEntered = true
                running += 1
                peak = maxOf(peak, running)
                running -= 1
            }
        }
        runCurrent()
        assertFalse(secondEntered)
        assertEquals(1, peak)
        release.complete(Unit)
        first.join()
        second.join()
        assertEquals(1, peak)
    }

    @Test
    fun offerLoadingUsesTheExistingEndpointAndSurvivesNetworkLoss() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"offers":[]}"""))
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.enqueue(json("""{"offers":[${offerJson()}]}"""))
        server.start()
        try {
            val riders = retrofit(server.url("/").toString(), httpClient()).create(RiderService::class.java)
            val empty = riders.offers()
            assertTrue(empty.isSuccessful)
            assertTrue(empty.body()!!.offers.isEmpty())
            val lost = runCatching { riders.offers() }
            assertTrue(lost.isFailure)
            val loaded = riders.offers()
            assertEquals(1, loaded.body()!!.offers.size)
            assertEquals("Parcel for Avondale", loaded.body()!!.offers.first().parcel.description)
            assertEquals("/riders/me/offers", server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)?.path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun onlineWithNoAssignmentsStillReceivesRequests() {
        assertFalse(showsReceivingControl())
        assertEquals(ReceivingAlignment.None, receivingAlignment("AVAILABLE", true))
        assertEquals(0, workloadCounts(emptyList()).flexible)
        assertEquals(0, workloadCounts(emptyList()).express)
    }

    @Test
    fun offlineStopsReceivingWithoutASeparateSwitch() {
        assertFalse(showsReceivingControl())
        assertEquals(ReceivingAlignment.None, receivingAlignment("OFFLINE", false))
    }

    @Test
    fun offlineWithAssignmentsStillCountsWorkload() {
        val counts = workloadCounts(listOf("FLEXIBLE", "FLEXIBLE", "EXPRESS"))
        assertEquals(2, counts.flexible)
        assertEquals(1, counts.express)
        assertEquals(ReceivingAlignment.Disable, receivingAlignment("OFFLINE", true))
        assertFalse(showsReceivingControl())
    }

    @Test
    fun expressAlongsideFlexibleDoesNotChangeOnlineStatus() {
        val counts = workloadCounts(listOf("FLEXIBLE", "EXPRESS", "FLEXIBLE"))
        assertEquals(2, counts.flexible)
        assertEquals(1, counts.express)
        assertEquals(ReceivingAlignment.None, receivingAlignment("AVAILABLE", true))
    }

    @Test
    fun homeWalletBalanceUsesAvailableCapacity() {
        assertEquals("20.00", homeWalletAmount("20.00"))
        assertEquals("0.04", homeWalletAmount("0.04"))
        assertNull(homeWalletAmount(null))
        assertNull(homeWalletAmount("  "))
    }

    @Test
    fun marketplaceFlagOffKeepsTheSingleDeliveryDashboard() {
        val active = com.riders.rider.feature.delivery.domain.ActiveDelivery(
            deliveryId = "delivery-1",
            assignmentId = "assignment-1",
            status = "ASSIGNED",
        )
        val shift = homeShift("AVAILABLE", true, active)
        assertTrue(showsV1ActiveDelivery(receiving = null, shift = shift))
        assertFalse(showsV1ActiveDelivery(receiving = true, shift = shift))
        assertFalse(showsV1ActiveDelivery(receiving = null, shift = shift, committedV2 = true))
        assertFalse(showsV1ActiveDelivery(receiving = null, shift = shift, assignmentsUnknown = true))
        assertFalse(showsReceivingControl())
        assertTrue(shift.showOffers)
        assertTrue(shift.showActiveDelivery)
    }

    @Test
    fun availableWithAssignmentsIsStillAWorkload() {
        val counts = workloadCounts(listOf("FLEXIBLE", "FLEXIBLE"))
        val shift = homeShift("AVAILABLE", true, null)
        assertEquals(2, counts.flexible)
        assertFalse(shift.showActiveDelivery)
        assertEquals(ReceivingAlignment.None, receivingAlignment("AVAILABLE", true))
    }

    @Test
    fun sessionFailureStaysSeparateFromADisabledMarketplaceAndANetworkLoss() {
        assertEquals(DashboardFailure.Authentication, dashboardFailure(ApiError.SessionEnded))
        assertEquals(DashboardFailure.Authentication, dashboardFailure(ApiError.Forbidden))
        assertEquals(DashboardFailure.MarketplaceDisabled, dashboardFailure(ApiError.Unexpected("Bidding is not available")))
        assertEquals(DashboardFailure.Network, dashboardFailure(ApiError.Network))
        assertEquals(true, receivingAfterRefresh(previous = true, loaded = null, loadedFromServer = false))
        assertEquals(null, receivingAfterRefresh(previous = true, loaded = null, loadedFromServer = true))
    }

    @Test
    fun assignmentReadKeepsTheAcceptedBidAndOlderPayloadsStillParse() = runTest {
        val server = MockWebServer()
        val body = """
            {"assignments":[
              {"assignmentId":"flex","deliveryId":"delivery-flex","status":"RIDER_ASSIGNED","serviceClass":"FLEXIBLE","deliverBy":"2026-10-25T16:00:00.000Z","agreedPrice":"12.50","parcel":{"description":"Documents","size":"SMALL"},"pickup":{"address":"Pickup","contactName":"A","contactPhone":"+263771111111"},"dropoff":{"address":"Dropoff","contactName":"B","contactPhone":"+263772222222"}},
              {"assignmentId":"express","deliveryId":"delivery-express","status":"COLLECTING","serviceClass":"EXPRESS","deliverBy":"2026-10-25T16:00:00.000Z","agreedPrice":"8.00","parcel":{"description":"Box","size":"MEDIUM"},"pickup":{"address":"Pickup","contactName":"A","contactPhone":"+263771111111"},"dropoff":{"address":"Dropoff","contactName":"B","contactPhone":"+263772222222"}},
              {"assignmentId":"legacy","deliveryId":"delivery-legacy","status":"ASSIGNED","parcel":{"description":"Letter","size":"SMALL"},"pickup":{"address":"Pickup","contactName":"A","contactPhone":"+263771111111"},"dropoff":{"address":"Dropoff","contactName":"B","contactPhone":"+263772222222"}}
            ]}
        """.trimIndent()
        server.enqueue(json(body))
        server.start()
        try {
            val riders = retrofit(server.url("/").toString(), httpClient()).create(RiderService::class.java)
            val listed = riders.assignments()
            assertEquals(listOf("FLEXIBLE", "EXPRESS", null), listed.assignments.map { it.serviceClass })
            assertEquals("12.50", listed.assignments[0].agreedPrice)
            assertEquals("8.00", listed.assignments[1].agreedPrice)
            assertNull(listed.assignments[2].agreedPrice)
            assertNull(listed.assignments[2].deliverBy)
            val parsed = ApiJson.decodeFromString(LiveAssignmentsResponse.serializer(), body)
            assertEquals(1, workloadCounts(parsed.assignments.map { it.serviceClass }).flexible)
            assertEquals(1, workloadCounts(parsed.assignments.map { it.serviceClass }).express)
            assertEquals("/riders/me/assignments", server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)?.path)
            assertFalse(showsReceivingControl())
        } finally {
            server.shutdown()
        }
    }

    private fun sample(approval: String, licence: String, motorcycle: Boolean, availability: String) = RiderOnboarding(
        licenceVerificationStatus = licence,
        approvalStatus = approval,
        availability = availability,
        licenceNumber = null,
        licenceClass = null,
        rejectionReason = null,
        verifiedMotorcycleCount = if (motorcycle) 1 else 0,
        activeVerifiedMotorcycle = motorcycle,
    )
}

private fun json(body: String, code: Int = 200): MockResponse {
    return MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
}

private fun offerJson(): String = """
    {"assignmentId":"offer-1","deliveryId":"delivery-1","expiresAt":"2026-10-20T12:01:00Z","offeredPrice":"2.00","currency":"USD","payer":"SENDER","paymentMethod":"CASH","parcel":{"description":"Parcel for Avondale","size":"SMALL"},"pickup":{"address":"Sam Levy's Village","landmark":null,"contactName":"Nyasha","contactPhone":"+263771111111"},"dropoff":{"address":"Avondale Shopping Centre","landmark":null,"contactName":"Tendai","contactPhone":"+263772222222"}}
""".trim()
