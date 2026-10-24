package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.text
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.MemorySessionStore
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.data.VerifyOutcome
import com.riders.rider.feature.auth.domain.WhatsAppRelease
import com.riders.rider.feature.auth.domain.authEntryActions
import com.riders.rider.feature.auth.domain.isVerificationCode
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderWhatsAppAuthTest {
    @Test
    fun defaultBuildKeepsSmsAndHidesWhatsAppActions() {
        assertFalse(WhatsAppRelease.ENABLED)
        val actions = authEntryActions()
        assertTrue(actions.smsRegistration)
        assertTrue(actions.smsLogin)
        assertTrue(actions.passwordLogin)
        assertFalse(actions.whatsappRegistration)
        assertFalse(actions.passwordRecovery)
    }

    @Test
    fun verificationCodeMatchesTheBackendRange() {
        assertTrue(isVerificationCode("1234"))
        assertTrue(isVerificationCode("123456"))
        assertTrue(isVerificationCode("1234567890"))
        assertFalse(isVerificationCode("123"))
        assertFalse(isVerificationCode("12345678901"))
        assertFalse(isVerificationCode("12345a"))
    }

    @Test
    fun whatsAppRegistrationStartsWithoutASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"pending"}"""))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).registerWithPassword(
                "+263771234567",
                "correct-horse",
                "Tendai Moyo",
                "12 Samora Machel Avenue",
            )
            assertTrue(result is ApiResult.Ok)
            assertNull(store.read())
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/whatsapp", recorded.path)
            val body = recorded.body.readUtf8()
            assertTrue(body.contains(""""whatsappConsent":true"""))
            assertFalse(body.contains("accessToken"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verificationCreatesASessionOnlyAfterTheCodeIsAccepted() = runTest {
        val server = MockWebServer()
        server.enqueue(session())
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("whatsapp", "+263771234567", "123456")
            assertEquals(VerifyOutcome.SignedIn, (result as ApiResult.Ok).value)
            assertEquals("refresh-token", store.read()?.refreshToken)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/whatsapp/verify", recorded.path)
            assertTrue(recorded.body.readUtf8().contains(""""code":"123456""""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun resendUsesTheWhatsAppRegistrationEndpoint() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"pending"}"""))
        server.start()
        try {
            val result = AuthRepository(server.auth(), MemorySessionStore()).resendWhatsAppRegistration("+263771234567")
            assertTrue(result is ApiResult.Ok)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/whatsapp/resend", recorded.path)
            assertTrue(recorded.body.readUtf8().contains("+263771234567"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun invalidCodeDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Verification code is invalid","statusCode":401}""", 401))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("whatsapp", "+263771234567", "000000")
            assertEquals("Verification code is invalid", (result as ApiResult.Err).error.text())
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun expiredCodeDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Verification code is invalid","statusCode":401}""", 401))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("whatsapp", "+263771234567", "999999")
            assertEquals("Verification code is invalid", (result as ApiResult.Err).error.text())
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun rateLimitIsShownAndDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Too many verification attempts. Try again later.","statusCode":429}""", 429))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).resendWhatsAppRegistration("+263771234567")
            assertEquals("Too many verification attempts. Try again later.", (result as ApiResult.Err).error.text())
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun networkFailureDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("whatsapp", "+263771234567", "123456")
            assertEquals(ApiError.Network, (result as ApiResult.Err).error)
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun forgotPasswordRequestsAWhatsAppCodeWithoutASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"pending"}"""))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).requestPasswordReset("+263771234567")
            assertTrue(result is ApiResult.Ok)
            assertNull(store.read())
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/password/forgot", recorded.path)
            val body = recorded.body.readUtf8()
            assertTrue(body.contains(""""whatsappConsent":true"""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun passwordResetClearsTheLocalSessionOnlyAfterSuccess() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(204))
        server.start()
        try {
            val store = MemorySessionStore()
            store.write(AuthSession("access", "refresh", "soon", "later"))
            val result = AuthRepository(server.auth(), store).resetPassword("+263771234567", "123456", "correct-horse")
            assertTrue(result is ApiResult.Ok)
            assertNull(store.read())
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/password/reset", recorded.path)
            assertTrue(recorded.body.readUtf8().contains(""""code":"123456""""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun failedPasswordResetKeepsTheExistingSession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Authentication failed","statusCode":401}""", 401))
        server.start()
        try {
            val store = MemorySessionStore()
            store.write(AuthSession("access", "refresh", "soon", "later"))
            val result = AuthRepository(server.auth(), store).resetPassword("+263771234567", "000000", "correct-horse")
            assertEquals("Authentication failed", (result as ApiResult.Err).error.text())
            assertEquals("refresh", store.read()?.refreshToken)
        } finally {
            server.shutdown()
        }
    }
}

private fun json(body: String, code: Int = 200): MockResponse {
    return MockResponse().setResponseCode(code).setBody(body).addHeader("Content-Type", "application/json")
}

private fun session(): MockResponse {
    return json("""{"accessToken":"access-token","refreshToken":"refresh-token","accessTokenExpiresAt":"soon","refreshTokenExpiresAt":"later"}""")
}

private fun MockWebServer.auth(): AuthService {
    return retrofit(url("/").toString(), httpClient()).create(AuthService::class.java)
}
