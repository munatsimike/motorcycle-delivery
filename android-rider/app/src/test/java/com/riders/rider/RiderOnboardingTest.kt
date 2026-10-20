package com.riders.rider

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.network.text
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.onboarding.domain.LICENCE_IMAGE_MAX_BYTES
import com.riders.rider.feature.onboarding.domain.MotorcycleDraft
import com.riders.rider.feature.onboarding.domain.OnboardingStep
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.canEditMotorcycle
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.canSelectMotorcycle
import com.riders.rider.feature.onboarding.domain.licenceImageIssue
import com.riders.rider.feature.onboarding.domain.licenceStatusAfterImageUpload
import com.riders.rider.feature.onboarding.domain.motorcycleIssue
import com.riders.rider.feature.onboarding.domain.needsOnboarding
import com.riders.rider.feature.onboarding.domain.nextOnboardingStep
import com.riders.rider.feature.onboarding.domain.previousOnboardingStep
import com.riders.rider.feature.onboarding.domain.profileCompletion
import com.riders.rider.feature.onboarding.domain.retainDraft
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

class RiderOnboardingTest {
    @Test
    fun onboardingMovesForwardOnlyWhenEachStepIsReady() {
        assertEquals(OnboardingStep.Licence, nextOnboardingStep(OnboardingStep.Profile, false, false))
        assertNull(nextOnboardingStep(OnboardingStep.Licence, licenceReady = false, hasMotorcycle = false))
        assertEquals(OnboardingStep.Motorcycle, nextOnboardingStep(OnboardingStep.Licence, true, false))
        assertNull(nextOnboardingStep(OnboardingStep.Motorcycle, true, hasMotorcycle = false))
        assertEquals(OnboardingStep.Status, nextOnboardingStep(OnboardingStep.Motorcycle, true, true))
        assertEquals(OnboardingStep.Profile, previousOnboardingStep(OnboardingStep.Licence))
        assertEquals(OnboardingStep.Motorcycle, previousOnboardingStep(OnboardingStep.Status))
    }

    @Test
    fun profileStaysReadOnlyAndReportsWhatIsMissing() {
        val pending = sample(approval = "PENDING", licence = "PENDING", active = false)
        assertEquals(
            "Still needed: a driving licence photo, motorcycle details, account approval.",
            profileCompletion(pending, hasLicenceImage = false, motorcycleCount = 0),
        )
        assertEquals("Your profile is complete.", profileCompletion(approved(), true, 1))
        assertTrue(needsOnboarding(pending))
        assertFalse(needsOnboarding(approved()))
    }

    @Test
    fun licenceImagesAcceptOnlyJpegPngAndWebpWithinFiveMegabytes() {
        assertNull(licenceImageIssue(jpeg()))
        assertNull(licenceImageIssue(png()))
        assertNull(licenceImageIssue(webp()))
        assertEquals("Choose a licence image", licenceImageIssue(byteArrayOf()))
        assertEquals("Licence image is too large", licenceImageIssue(ByteArray(LICENCE_IMAGE_MAX_BYTES + 1) { 0xFF.toByte() }))
        assertEquals("Licence image must be a JPEG, PNG, or WebP file", licenceImageIssue(byteArrayOf(0x47, 0x49, 0x46, 0x38)))
    }

    @Test
    fun uploadingAnImageDoesNotVerifyTheLicence() {
        assertEquals("PENDING", licenceStatusAfterImageUpload("PENDING"))
        assertEquals("REJECTED", licenceStatusAfterImageUpload("REJECTED"))
        assertFalse(canReplaceLicence("VERIFIED"))
        assertTrue(canReplaceLicence("PENDING"))
        assertTrue(canReplaceLicence("REJECTED"))
    }

    @Test
    fun motorcycleDetailsFollowTheBackendFieldsAndEditRules() {
        assertNull(motorcycleIssue(MotorcycleDraft("AFS 1234", "Honda", "Ace", "Red")))
        assertEquals("Enter a registration number", motorcycleIssue(MotorcycleDraft("  ", "Honda", "Ace", "Red")))
        assertEquals("Enter a registration number", motorcycleIssue(MotorcycleDraft("A".repeat(21), "Honda", "Ace", "Red")))
        assertEquals("Enter a colour", motorcycleIssue(MotorcycleDraft("AFS 1234", "Honda", "Ace", " ")))
        assertTrue(canEditMotorcycle("PENDING"))
        assertTrue(canEditMotorcycle("REJECTED"))
        assertFalse(canEditMotorcycle("VERIFIED"))
        assertFalse(canEditMotorcycle("REVOKED"))
        assertTrue(canSelectMotorcycle("VERIFIED", isActive = false))
        assertFalse(canSelectMotorcycle("PENDING", isActive = false))
        val kept = retainDraft(MotorcycleDraft("AFS 1234", "Honda", "Ace", "Red"))
        assertEquals("AFS 1234", kept.registrationNumber)
        assertEquals("Red", kept.colour)
    }

    @Test
    fun approvalStatesStaySeparateFromLicenceAndMotorcycleVerification() {
        assertEquals("Pending review", approvalStatusTitle("PENDING"))
        assertEquals("Approved", approvalStatusTitle("APPROVED"))
        assertEquals("Rejected", approvalStatusTitle("REJECTED"))
        assertEquals("Suspended", approvalStatusTitle("SUSPENDED"))
        val pending = riderReadiness(sample("PENDING", "PENDING", false))
        assertFalse(pending.canGoOnline)
        assertFalse(pending.canAcceptDeliveries)
        val approved = riderReadiness(approved())
        assertTrue(approved.canGoOnline)
        assertFalse(approved.canAcceptDeliveries)
        val rejected = riderReadiness(sample("REJECTED", "VERIFIED", true))
        assertFalse(rejected.canAcceptDeliveries)
        val busy = riderReadiness(approved().copy(availability = "BUSY"))
        assertFalse(busy.canGoOnline)
        assertFalse(busy.canAcceptDeliveries)
    }

    @Test
    fun profileAndMotorcycleCallsUseTheExistingRiderEndpoints() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"fullName":"Tendai Moyo","phone":"+263771234567"}"""))
        server.enqueue(json(onboardingJson()))
        server.enqueue(json("""{"message":"No licence image has been uploaded","statusCode":404}""", 404))
        server.enqueue(json("[]"))
        server.start()
        try {
            val repository = VerificationRepository(server.service())
            val profile = repository.profile() as ApiResult.Ok
            assertEquals("Tendai Moyo", profile.value.fullName)
            assertEquals("+263771234567", profile.value.phone)
            assertTrue(repository.onboarding() is ApiResult.Ok)
            val licence = repository.licence() as ApiResult.Ok
            assertNull(licence.value)
            val motorcycles = repository.motorcycles() as ApiResult.Ok
            assertTrue(motorcycles.value.isEmpty())
            assertEquals("/riders/me/profile", server.takeRequest().path)
            assertEquals("/riders/me/onboarding", server.takeRequest().path)
            assertEquals("/riders/me/licence-image", server.takeRequest().path)
            assertEquals("/riders/me/motorcycles", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun licenceUploadReportsProgressAndLeavesVerificationPending() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"id":"img-1","reviewStatus":"PENDING","contentType":"image/jpeg","byteSize":4,"uploadedAt":"2026-10-20T00:00:00.000Z"}""", 201))
        server.start()
        try {
            val repository = VerificationRepository(server.service())
            val progress = mutableListOf<Int>()
            val result = repository.uploadLicence(jpeg()) { progress += it } as ApiResult.Ok
            assertEquals("PENDING", result.value.reviewStatus)
            assertEquals("PENDING", licenceStatusAfterImageUpload("PENDING"))
            assertTrue(progress.last() == 100)
            val recorded = server.takeRequest()
            assertEquals("/riders/me/licence-image", recorded.path)
            val body = recorded.body.readUtf8()
            assertTrue(body.contains("name=\"image\""))
            assertTrue(body.contains("image/jpeg"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun licenceUploadKeepsTheImageWhenTheServerRejectsIt() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Licence image is too large","statusCode":413}""", 413))
        server.enqueue(json("""{"message":"Too many licence image uploads. Try again later.","statusCode":429}""", 429))
        server.enqueue(json("""{"message":"A verified licence cannot be replaced yet","statusCode":409}""", 409))
        server.start()
        try {
            val repository = VerificationRepository(server.service())
            assertEquals("Licence image is too large", (repository.uploadLicence(jpeg()) {}).errorText())
            assertEquals("Too many licence image uploads. Try again later.", (repository.uploadLicence(jpeg()) {}).errorText())
            assertEquals("A verified licence cannot be replaced yet", (repository.uploadLicence(jpeg()) {}).errorText())
            assertEquals("PENDING", licenceStatusAfterImageUpload("PENDING"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun sessionExpiryAndForbiddenAccessStopTheFlow() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Authentication failed","statusCode":401}""", 401))
        server.enqueue(json("""{"message":"Rider access is required","statusCode":403}""", 403))
        server.start()
        try {
            val repository = VerificationRepository(server.service())
            assertEquals("Your session has ended. Sign in again.", repository.profile().errorText())
            assertEquals("Rider access is required.", repository.profile().errorText())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun networkLossCanBeRetriedWithoutDroppingTheDraft() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.enqueue(json("""{"id":"bike-1","registrationNumber":"AFS 1234","make":"Honda","model":"Ace","colour":"Red","verificationStatus":"PENDING","isActive":false,"createdAt":"2026-10-20T00:00:00.000Z","updatedAt":"2026-10-20T00:00:00.000Z"}""", 201))
        server.start()
        try {
            val repository = VerificationRepository(server.service())
            val draft = MotorcycleDraft("AFS 1234", "Honda", "Ace", "Red")
            val failed = repository.saveMotorcycle(null, draft)
            assertTrue(failed is ApiResult.Err)
            assertEquals("AFS 1234", retainDraft(draft).registrationNumber)
            val saved = repository.saveMotorcycle(null, retainDraft(draft)) as ApiResult.Ok
            assertEquals("PENDING", saved.value.verificationStatus)
            val requests = mutableListOf<okhttp3.mockwebserver.RecordedRequest>()
            repeat(2) {
                server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)?.let { requests += it }
            }
            val posted = requests.last { it.method == "POST" }
            assertEquals("/riders/me/motorcycles", posted.path)
            assertTrue(posted.body.readUtf8().contains("AFS 1234"))
        } finally {
            server.shutdown()
        }
    }

    private fun approved() = sample("APPROVED", "VERIFIED", true)

    private fun sample(approval: String, licence: String, active: Boolean) = RiderOnboarding(
        licenceVerificationStatus = licence,
        approvalStatus = approval,
        availability = "OFFLINE",
        licenceNumber = null,
        licenceClass = null,
        rejectionReason = null,
        verifiedMotorcycleCount = if (active) 1 else 0,
        activeVerifiedMotorcycle = active,
    )
}

private fun ApiResult<*>.errorText(): String = (this as ApiResult.Err).error.text()

private fun MockWebServer.service(): RiderService {
    return retrofit(url("/").toString(), httpClient()).create(RiderService::class.java)
}

private fun json(body: String, code: Int = 200): MockResponse {
    return MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
}

private fun onboardingJson(): String = """
    {"licenceVerificationStatus":"PENDING","approvalStatus":"PENDING","availability":"OFFLINE","licenceNumber":null,"licenceClass":null,"rejectionReason":null,"verifiedMotorcycleCount":0,"activeVerifiedMotorcycle":false}
""".trim()

private fun jpeg(): ByteArray = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())

private fun png(): ByteArray = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00)

private fun webp(): ByteArray {
    val bytes = ByteArray(12)
    "RIFF".encodeToByteArray().copyInto(bytes)
    "WEBP".encodeToByteArray().copyInto(bytes, destinationOffset = 8)
    return bytes
}
