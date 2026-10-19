package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.OnboardingResponse
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
import com.riders.rider.feature.delivery.domain.canRelease
import com.riders.rider.feature.delivery.domain.nextDeliveryStatus
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.riderReadiness
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderDomainTest {
    @Test
    fun normalizesZimbabweNumbers() {
        assertEquals("+263771234567", normalizeRiderPhone("0771234567"))
        assertEquals("+263771234567", normalizeRiderPhone("771234567"))
        assertEquals("+263771234567", normalizeRiderPhone("+263 77 123 4567"))
        assertEquals("+263771234567", normalizeRiderPhone("00263771234567"))
    }

    @Test
    fun rejectsNumbersOutsideZimbabwe() {
        assertInvalid("+31612345678")
        assertInvalid("12345")
        assertInvalid("")
    }

    @Test
    fun readsApprovalLicenceAndMotorcycleStates() {
        val pending = readiness("""{"licenceVerificationStatus":"PENDING","approvalStatus":"PENDING","availability":"OFFLINE","verifiedMotorcycleCount":0,"activeVerifiedMotorcycle":false}""")
        assertFalse(pending.canAcceptDeliveries)
        assertEquals("Pending", pending.approvalLabel)
        assertEquals("Pending review", pending.licenceLabel)

        val rejected = readiness("""{"licenceVerificationStatus":"REJECTED","approvalStatus":"APPROVED","availability":"OFFLINE","rejectionReason":"Photo is unreadable","verifiedMotorcycleCount":0,"activeVerifiedMotorcycle":false}""")
        assertTrue(rejected.message.contains("Photo is unreadable"))

        val suspended = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"SUSPENDED","availability":"AVAILABLE","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}""")
        assertFalse(suspended.canAcceptDeliveries)
        assertEquals("Suspended", suspended.approvalLabel)

        val ready = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"APPROVED","availability":"AVAILABLE","licenceNumber":"12345","licenceClass":"B","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}""")
        assertTrue(ready.canAcceptDeliveries)
        assertEquals("Available", ready.availabilityLabel)
    }

    @Test
    fun offerConflictShowsTheServerMessage() {
        val error = mapHttpFailure(409, """{"message":"This offer has expired"}""")
        assertEquals("This offer has expired", error.text())
        assertTrue(error is ApiError.Conflict)
    }

    @Test
    fun validationMessageCanBeAList() {
        val error = mapHttpFailure(400, """{"message":["Phone is required","Code is required"]}""")
        assertEquals("Phone is required, Code is required", error.text())
    }

    @Test
    fun acceptRetriesUseTheSameKey() = runTest {
        val keys = AcceptKeys()
        val first = keys.keyFor("assignment-1")
        val second = keys.keyFor("assignment-1")
        val other = keys.keyFor("assignment-2")
        assertEquals(first, second)
        assertFalse(first == other)
    }

    @Test
    fun deliveryOffersOnlyTheNextStatus() {
        assertEquals("ARRIVED_AT_PICKUP", nextDeliveryStatus("ASSIGNED"))
        assertEquals("PICKED_UP", nextDeliveryStatus("ARRIVED_AT_PICKUP"))
        assertEquals("IN_TRANSIT", nextDeliveryStatus("PICKED_UP"))
        assertEquals("ARRIVED_AT_DROPOFF", nextDeliveryStatus("IN_TRANSIT"))
        assertEquals("DELIVERED", nextDeliveryStatus("ARRIVED_AT_DROPOFF"))
        assertNull(nextDeliveryStatus("DELIVERED"))
        assertTrue(canRelease("ASSIGNED"))
        assertTrue(canRelease("ARRIVED_AT_PICKUP"))
        assertFalse(canRelease("PICKED_UP"))
        assertFalse(canRelease("DELIVERED"))
    }

    @Test
    fun locationUploadsStayInMemory() = runTest {
        var now = 0L
        val relay = LocationRelay(persist = { error("coordinates were stored") }, clock = { now })
        val fix = GpsFix(-17.8252, 31.0335)
        var uploads = 0
        assertFalse(relay.handle(active = false, fix) { uploads += 1; true })
        assertEquals(0, uploads)
        assertFalse(relay.handle(active = true, fix) { false })
        now += 10_000L
        assertTrue(relay.handle(active = true, fix) { uploads += 1; true })
        assertEquals(1, uploads)
    }

    private fun readiness(json: String) = riderReadiness(ApiJson.decodeFromString(OnboardingResponse.serializer(), json).toOnboarding())

    private fun assertInvalid(input: String) {
        try {
            normalizeRiderPhone(input)
            error("expected rejection")
        } catch (error: IllegalArgumentException) {
            assertEquals("Enter a valid Zimbabwe mobile number", error.message)
        }
    }
}

private fun OnboardingResponse.toOnboarding(): RiderOnboarding {
    return RiderOnboarding(
        licenceVerificationStatus,
        approvalStatus,
        availability,
        licenceNumber,
        licenceClass,
        rejectionReason,
        verifiedMotorcycleCount,
        activeVerifiedMotorcycle,
    )
}
