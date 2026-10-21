package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.OnboardingResponse
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.domain.SessionGate
import com.riders.rider.feature.auth.domain.biometricHomeAction
import com.riders.rider.feature.auth.domain.initialBiometricState
import com.riders.rider.feature.auth.domain.DEBUG_REGISTRATION_FULL_NAME
import com.riders.rider.feature.auth.domain.normalizeRiderAddress
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.registrationFullName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
import com.riders.rider.feature.auth.domain.reduceSession
import com.riders.rider.feature.auth.domain.resolveAppEntry
import com.riders.rider.feature.auth.domain.riderPhoneEntry
import com.riders.rider.feature.auth.domain.sessionGate
import com.riders.rider.feature.auth.domain.shouldOfferBiometric
import com.riders.rider.feature.delivery.domain.canRelease
import com.riders.rider.feature.delivery.domain.nextDeliveryStatus
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.riderReadiness
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
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
        assertEquals("+263771234567", normalizeRiderPhone(riderPhoneEntry("77 123 4567")))
        assertEquals("+263771234567", normalizeRiderPhone(riderPhoneEntry("0771234567")))
        assertEquals("+263771234567", normalizeRiderPhone(riderPhoneEntry("+263 77 123 4567")))
    }

    @Test
    fun riderAccountUsesAnIndividualNameAndAddress() {
        assertEquals("Tendai Moyo", normalizeRiderName("  Tendai   Moyo  "))
        assertEquals("12 Samora Machel Avenue", normalizeRiderAddress("  12   Samora Machel Avenue  "))
        assertThrows(IllegalArgumentException::class.java) { normalizeRiderName(" ") }
        assertThrows(IllegalArgumentException::class.java) { normalizeRiderAddress(" ") }
    }

    @Test
    fun debugRegistrationUsesTheTemporaryName() {
        assertEquals("Tonderai Moyo", registrationFullName(debugBuild = true))
        assertEquals(DEBUG_REGISTRATION_FULL_NAME, registrationFullName(debugBuild = true))
    }

    @Test
    fun releaseRegistrationDoesNotInventAName() {
        assertNull(registrationFullName(debugBuild = false))
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
        assertFalse(pending.canGoOnline)
        assertEquals("Pending", pending.approvalLabel)
        assertEquals("Pending review", pending.licenceLabel)

        val rejected = readiness("""{"licenceVerificationStatus":"REJECTED","approvalStatus":"APPROVED","availability":"OFFLINE","rejectionReason":"Photo is unreadable","verifiedMotorcycleCount":0,"activeVerifiedMotorcycle":false}""")
        assertTrue(rejected.message.contains("Photo is unreadable"))
        assertFalse(rejected.canGoOnline)

        val suspended = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"SUSPENDED","availability":"AVAILABLE","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}""")
        assertFalse(suspended.canAcceptDeliveries)
        assertEquals("Suspended", suspended.approvalLabel)

        val ready = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"APPROVED","availability":"AVAILABLE","licenceNumber":"12345","licenceClass":"B","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}""")
        assertTrue(ready.canAcceptDeliveries)
        assertFalse(ready.canGoOnline)
        assertEquals("Available", ready.availabilityLabel)

        val offline = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"APPROVED","availability":"OFFLINE","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}""")
        assertTrue(offline.canGoOnline)
        assertFalse(offline.canAcceptDeliveries)

        val noMotorcycle = readiness("""{"licenceVerificationStatus":"VERIFIED","approvalStatus":"APPROVED","availability":"OFFLINE","verifiedMotorcycleCount":0,"activeVerifiedMotorcycle":false}""")
        assertFalse(noMotorcycle.canGoOnline)
        assertTrue(noMotorcycle.message.contains("verified motorcycle"))
    }

    @Test
    fun offerConflictShowsTheServerMessage() {
        val error = mapHttpFailure(409, """{"message":"This offer has expired"}""")
        assertEquals("This offer has expired", error.text())
        assertTrue(error is ApiError.Conflict)
    }

    @Test
    fun signInRejectionKeepsTheServerMessage() {
        val error = mapHttpFailure(401, """{"message":"Verification code is invalid"}""", establishedSession = false)
        assertEquals("Verification code is invalid", error.text())
    }

    @Test
    fun protectedUnauthorizedEndsTheSession() {
        val error = mapHttpFailure(401, """{"message":"Authentication failed"}""")
        assertEquals("Your session has ended. Sign in again.", error.text())
        assertTrue(error is ApiError.SessionEnded)
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

    @Test
    fun biometricGateUsesTheStoredSession() {
        assertEquals(SessionGate.SignedOut, sessionGate(false, true, true))
        assertEquals(SessionGate.Restore, sessionGate(true, false, true))
        assertEquals(SessionGate.Restore, sessionGate(true, false, false))
        assertEquals(SessionGate.Biometric, sessionGate(true, true, true))
        assertEquals(SessionGate.BiometricUnavailable, sessionGate(true, true, false))
    }

    @Test
    fun freshSignInSkipsUnlockAndCanOfferBiometrics() {
        val cold = reduceSession(initialBiometricState(hasStoredSession = true), hasSession = true)
        val refreshed = reduceSession(cold, hasSession = true)
        assertFalse(refreshed.unlocked)
        assertFalse(refreshed.freshSignIn)
        assertEquals(
            AppEntry.Unlock,
            resolveAppEntry(true, biometricEnabled = true, biometricAvailable = true, cold.unlocked, cold.freshSignIn, declined = false),
        )
        assertEquals(
            AppEntry.Home,
            resolveAppEntry(true, biometricEnabled = false, biometricAvailable = false, cold.unlocked, cold.freshSignIn, declined = false),
        )

        val signedIn = reduceSession(initialBiometricState(hasStoredSession = false), hasSession = true)
        assertTrue(signedIn.unlocked)
        assertTrue(signedIn.freshSignIn)
        assertEquals(
            AppEntry.Home,
            resolveAppEntry(true, biometricEnabled = true, biometricAvailable = true, signedIn.unlocked, signedIn.freshSignIn, declined = false),
        )
        assertEquals(
            AppEntry.Offer,
            resolveAppEntry(true, biometricEnabled = false, biometricAvailable = true, signedIn.unlocked, signedIn.freshSignIn, declined = false),
        )
        assertEquals(AppEntry.Home, resolveAppEntry(true, false, true, signedIn.unlocked, signedIn.freshSignIn, declined = true))
        assertEquals(AppEntry.Unlock, resolveAppEntry(true, true, false, unlocked = false, freshSignIn = false, declined = false))
        assertEquals(AppEntry.SignedOut, resolveAppEntry(false, true, true, unlocked = true, freshSignIn = true, declined = false))
    }

    @Test
    fun biometricOfferRequiresACapableDevice() {
        assertTrue(shouldOfferBiometric(freshSignIn = true, biometricAvailable = true, biometricEnabled = false, declined = false))
        assertFalse(shouldOfferBiometric(freshSignIn = false, biometricAvailable = true, biometricEnabled = false, declined = false))
        assertFalse(shouldOfferBiometric(freshSignIn = true, biometricAvailable = false, biometricEnabled = false, declined = false))
        assertFalse(shouldOfferBiometric(freshSignIn = true, biometricAvailable = true, biometricEnabled = true, declined = false))
        assertFalse(shouldOfferBiometric(freshSignIn = true, biometricAvailable = true, biometricEnabled = false, declined = true))
        assertEquals("Unlock with biometrics", biometricHomeAction(enabled = false, available = true))
        assertEquals("Turn off biometric unlock", biometricHomeAction(enabled = true, available = false))
        assertNull(biometricHomeAction(enabled = false, available = false))
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
