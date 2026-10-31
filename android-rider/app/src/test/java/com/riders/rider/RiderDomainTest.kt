package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.OnboardingResponse
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.domain.DEBUG_REGISTRATION_FULL_NAME
import com.riders.rider.feature.auth.domain.DeviceReplacementNotice
import com.riders.rider.feature.auth.domain.appEntry
import com.riders.rider.feature.auth.domain.resumedAssignmentId
import com.riders.rider.feature.auth.domain.signedOutStart
import com.riders.rider.feature.availability.domain.LocationCommand
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import com.riders.rider.feature.home.DashboardFailure
import com.riders.rider.feature.home.dashboardFailure
import com.riders.rider.feature.offers.domain.shouldPollOffers
import com.riders.rider.feature.auth.domain.normalizeRiderAddress
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.registrationFullName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
import com.riders.rider.feature.auth.domain.riderPhoneEntry
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.offers.domain.leavesAcceptUnresolved
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
    fun debugBuildsAcceptNetherlandsNumbers() {
        assertEquals("+31612345678", normalizeRiderPhone("0612345678", allowDutchTestNumbers = true))
        assertEquals("+31612345678", normalizeRiderPhone("612345678", allowDutchTestNumbers = true))
        assertEquals("+31612345678", normalizeRiderPhone("+31 6 12345678", allowDutchTestNumbers = true))
        assertEquals("+31612345678", normalizeRiderPhone("0031612345678", allowDutchTestNumbers = true))
        assertEquals(
            "+31612345678",
            normalizeRiderPhone(riderPhoneEntry("612345678", allowDutchTestNumbers = true), allowDutchTestNumbers = true),
        )
        assertInvalid("+31612345678")
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
        assertEquals("Online", ready.availabilityLabel)

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
    fun replacedSessionStopsTrackingAndReturnsToSignIn() {
        val error = mapHttpFailure(401, """{"message":"${DeviceReplacementNotice.MESSAGE}"}""")
        assertTrue(error is ApiError.SignedInElsewhere)
        assertEquals(DeviceReplacementNotice.MESSAGE, error.text())
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(error))
        assertEquals(DashboardFailure.Authentication, dashboardFailure(error))
        assertEquals("sign-in", signedOutStart(error.text()))
        assertFalse(shouldPollOffers(false))
        assertFalse(error.leavesAcceptUnresolved())
        assertEquals("delivery-1", resumedAssignmentId(listOf("delivery-1")))
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
    fun storedSessionOpensHomeWithoutABiometricPrompt() {
        assertEquals(AppEntry.SignedOut, appEntry(false))
        assertEquals(AppEntry.Home, appEntry(true))
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
