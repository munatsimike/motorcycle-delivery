package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.network.text
import com.riders.rider.feature.home.AvailabilityChange
import com.riders.rider.feature.home.beginAvailabilityChange
import com.riders.rider.feature.home.confirmAvailability
import com.riders.rider.feature.home.failAvailability
import com.riders.rider.feature.home.homeShift
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.riderReadiness
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
            assertTrue(empty.offers.isEmpty())
            val lost = runCatching { riders.offers() }
            assertTrue(lost.isFailure)
            val loaded = riders.offers()
            assertEquals(1, loaded.offers.size)
            assertEquals("Parcel for Avondale", loaded.offers.first().parcel.description)
            assertEquals("/riders/me/offers", server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)?.path)
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
