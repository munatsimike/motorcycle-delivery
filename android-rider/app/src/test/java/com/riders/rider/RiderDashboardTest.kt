package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.LiveAssignmentsResponse
import com.riders.rider.core.network.ReceivingRequest
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
import com.riders.rider.feature.home.homeShift
import com.riders.rider.feature.home.receivingAfterRefresh
import com.riders.rider.feature.home.receivingControl
import com.riders.rider.feature.home.showsV1ActiveDelivery
import com.riders.rider.feature.home.walletFigures
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
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.offerPriceLabel
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
        assertEquals("This offer has expired", offerExpiryLabel(expiresAt, after))
        assertTrue(offerExpiryLabel(expiresAt, before).startsWith("Expires at "))
        assertTrue(offerExpiryLabel(expiresAt, before).contains("s"))
        assertTrue(canAcceptOffer(expiresAt, before, accepting = false, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, after, accepting = false, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, before, accepting = true, unavailable = false))
        assertFalse(canAcceptOffer(expiresAt, before, accepting = false, unavailable = true))
    }

    @Test
    fun offeredPriceShowsCurrencyWithoutCallingItEarnings() {
        val label = offerPriceLabel("USD", "2.00")
        assertEquals("USD 2.00", label)
        assertFalse(label.contains("earning", ignoreCase = true))
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
    fun onlineReceivingWithNoAssignmentsKeepsTheSwitchOn() {
        val control = receivingControl(receiving = true, canAcceptDeliveries = true, changing = false)
        assertTrue(control.visible)
        assertTrue(control.checked)
        assertTrue(control.enabled)
        assertEquals(0, workloadCounts(emptyList()).flexible)
        assertEquals(0, workloadCounts(emptyList()).express)
    }

    @Test
    fun onlinePausedWithNoAssignmentsKeepsTheSwitchOff() {
        val control = receivingControl(receiving = false, canAcceptDeliveries = true, changing = false)
        assertTrue(control.visible)
        assertFalse(control.checked)
        assertTrue(control.enabled)
    }

    @Test
    fun manualPauseAndResumeStayOnTheReceivingPreference() {
        val online = receivingControl(receiving = true, canAcceptDeliveries = true, changing = false)
        assertTrue(online.enabled)
        val saving = receivingControl(receiving = true, canAcceptDeliveries = true, changing = true)
        assertTrue(saving.checked)
        assertFalse(saving.enabled)
        val paused = receivingControl(receiving = false, canAcceptDeliveries = true, changing = false)
        assertFalse(paused.checked)
        assertTrue(paused.enabled)
        val resumed = receivingControl(receiving = true, canAcceptDeliveries = true, changing = false)
        assertTrue(resumed.checked)
    }

    @Test
    fun offlineHidesTheSwitchActionAndKeepsSavedReceiving() {
        val control = receivingControl(receiving = false, canAcceptDeliveries = false, changing = false)
        assertTrue(control.visible)
        assertFalse(control.checked)
        assertFalse(control.enabled)
    }

    @Test
    fun offlineWithAssignmentsStillCountsWorkload() {
        val counts = workloadCounts(listOf("FLEXIBLE", "FLEXIBLE", "EXPRESS"))
        val control = receivingControl(receiving = false, canAcceptDeliveries = false, changing = false)
        assertEquals(2, counts.flexible)
        assertEquals(1, counts.express)
        assertFalse(control.enabled)
    }

    @Test
    fun expressAlongsideFlexibleDoesNotResetReceiving() {
        val counts = workloadCounts(listOf("FLEXIBLE", "EXPRESS", "FLEXIBLE"))
        val control = receivingControl(receiving = true, canAcceptDeliveries = true, changing = false)
        assertEquals(2, counts.flexible)
        assertEquals(1, counts.express)
        assertTrue(control.checked)
    }

    @Test
    fun walletCapacityAndReservedFeesStayWithTheMarketplaceDashboard() {
        assertEquals("20.00" to "1.50", walletFigures(marketplace = true, availableCapacity = "20.00", reservedFees = "1.50"))
        assertEquals(null to null, walletFigures(marketplace = false, availableCapacity = "20.00", reservedFees = "1.50"))
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
        assertFalse(receivingControl(receiving = null, canAcceptDeliveries = true, changing = false).visible)
        assertTrue(shift.showOffers)
        assertTrue(shift.showActiveDelivery)
    }

    @Test
    fun availableWithAssignmentsIsStillAWorkload() {
        val counts = workloadCounts(listOf("FLEXIBLE", "FLEXIBLE"))
        val shift = homeShift("AVAILABLE", true, null)
        assertEquals(2, counts.flexible)
        assertFalse(shift.showActiveDelivery)
        assertTrue(receivingControl(receiving = true, canAcceptDeliveries = true, changing = false).checked)
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
        server.enqueue(json("""{"availability":"AVAILABLE","receiving":false}"""))
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
            val saved = riders.receiving(ReceivingRequest(receiving = false))
            assertFalse(saved.receiving)
            assertEquals("AVAILABLE", saved.availability)
            val listedRequest = server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)
            val receivingRequest = server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)
            assertEquals("/riders/me/assignments", listedRequest?.path)
            assertEquals("PUT", receivingRequest?.method)
            assertEquals("/riders/me/receiving", receivingRequest?.path)
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
