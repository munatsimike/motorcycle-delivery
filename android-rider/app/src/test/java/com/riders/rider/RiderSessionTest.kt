package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.RefreshAuthenticator
import com.riders.rider.core.network.RefreshRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.SessionResponse
import com.riders.rider.core.network.SessionStorageException
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.performRefresh
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.network.text
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.MemorySessionStore
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.data.VerifyOutcome
import com.riders.rider.feature.auth.domain.MemoryBiometricPreference
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.profile.domain.logoutAllReportsGlobalSuccess
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.runTest
import okhttp3.Interceptor
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RiderSessionTest {
    @Test
    fun pendingLoginDoesNotSendACode() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"pending"}"""))
        server.start()
        try {
            val auth = server.auth()
            val result = AuthRepository(auth, MemorySessionStore()).requestLogin("+263771234567")
            assertTrue(result is ApiResult.Ok)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/login/otp", recorded.path)
            assertNull(recorded.getHeader("Authorization"))
            val body = recorded.body.readUtf8()
            assertTrue(body.contains("+263771234567"))
            assertTrue(!body.contains("code"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun invalidOtpShowsTheServerMessageAndDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Verification code is invalid","error":"Unauthorized","statusCode":401}""", 401))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("login", "+263771234567", "000000")
            assertEquals("Verification code is invalid", (result as ApiResult.Err).error.text())
            assertNull(store.read())
            assertEquals("/auth/rider/login/verify", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun debugRegistrationSendsTheTemporaryNameWithThePhone() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"pending"}"""))
        server.start()
        try {
            val result = AuthRepository(server.auth(), MemorySessionStore()).requestRegistration("+263771234567")
            assertTrue(result is ApiResult.Ok)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/otp", recorded.path)
            val body = recorded.body.readUtf8()
            assertTrue(body.contains("+263771234567"))
            assertTrue(body.contains("\"fullName\":\"Tonderai Moyo\""))
            assertFalse(body.contains("accountKind"))
            assertFalse(body.contains("register/complete"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun olderRegistrationVerificationSavesTheSession() = runTest {
        val server = MockWebServer()
        server.enqueue(session("access-1", "refresh-1"))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("registration", "+263771234567", "123456")
            assertEquals(ApiResult.Ok(VerifyOutcome.SignedIn), result)
            assertEquals("access-1", store.read()?.accessToken)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/verify", recorded.path)
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verifiedRegistrationKeepsExistingDetailsReadOnly() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"verified","registrationToken":"proof-token","fullName":"Rudo Ncube","phone":"+263771234567","address":"1 First Street","readOnly":["fullName","phone","address"],"missing":[]}"""))
        server.start()
        try {
            val result = AuthRepository(server.auth(), MemorySessionStore()).verify("registration", "+263771234567", "123456")
            assertEquals(
                ApiResult.Ok(VerifyOutcome.NeedsAccount("proof-token", "Rudo Ncube", "1 First Street", true)),
                result,
            )
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun existingAccountRegistrationSavesTheSession() = runTest {
        val server = MockWebServer()
        server.enqueue(session("access-existing", "refresh-existing"))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("registration", "+263771234567", "123456")
            assertEquals(ApiResult.Ok(VerifyOutcome.SignedIn), result)
            assertEquals("access-existing", store.read()?.accessToken)
            assertEquals("refresh-existing", store.read()?.refreshToken)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/verify", recorded.path)
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verifiedRegistrationWaitsForTheAccountForm() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"status":"verified","registrationToken":"proof-token"}"""))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("registration", "+263771234567", "123456")
            assertEquals(ApiResult.Ok(VerifyOutcome.NeedsAccount("proof-token")), result)
            assertNull(store.read())
            assertEquals("/auth/rider/register/verify", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun completingRegistrationSavesTheSessionAsAnIndividual() = runTest {
        val server = MockWebServer()
        server.enqueue(session("access-1", "refresh-1"))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).completeRegistration(
                "proof-token",
                "Tendai Moyo",
                "12 Samora Machel Avenue",
            )
            assertTrue(result is ApiResult.Ok)
            assertEquals("access-1", store.read()?.accessToken)
            val recorded = server.takeRequest()
            assertEquals("/auth/rider/register/complete", recorded.path)
            val body = recorded.body.readUtf8()
            assertTrue(body.contains("proof-token"))
            assertTrue(body.contains("Tendai Moyo"))
            assertTrue(body.contains("12 Samora Machel Avenue"))
            assertFalse(body.contains("accountKind"))
            assertFalse(body.contains("BUSINESS"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun rejectedRegistrationShowsTheServerMessage() = runTest {
        val server = MockWebServer()
        server.enqueue(json("""{"message":"Authentication failed","error":"Unauthorized","statusCode":401}""", 401))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("registration", "+263771234567", "123456")
            assertEquals("Authentication failed", (result as ApiResult.Err).error.text())
            assertNull(store.read())
            assertEquals("/auth/rider/register/verify", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verifyNetworkFailureDoesNotSaveASession() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("login", "+263771234567", "123456")
            assertEquals(ApiError.Network, (result as ApiResult.Err).error)
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verifySavesTheSession() = runTest {
        val server = MockWebServer()
        server.enqueue(session("access-1", "refresh-1"))
        server.start()
        try {
            val store = MemorySessionStore()
            val result = AuthRepository(server.auth(), store).verify("login", "+263771234567", "123456")
            assertTrue(result is ApiResult.Ok)
            assertEquals("access-1", store.read()?.accessToken)
            assertEquals("refresh-1", store.read()?.refreshToken)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun refreshRotatesTheSessionAndRetriesOnce() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(session("access-2", "refresh-2"))
        server.enqueue(json(ONBOARDING))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val riders = server.riders(store)
            val onboarding = riders.onboarding()
            assertEquals("APPROVED", onboarding.approvalStatus)
            assertEquals("refresh-2", store.read()?.refreshToken)
            server.takeRequest()
            val refresh = server.takeRequest()
            assertEquals("/auth/session/refresh", refresh.path)
            assertTrue(refresh.body.readUtf8().contains("refresh-1"))
            assertEquals("Bearer access-2", server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun failedRefreshClearsTheSession() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"message":"Unauthorized"}""").addHeader("Content-Type", "application/json"))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val result = apiCall { server.riders(store).onboarding() }
            assertEquals("Your session has ended. Sign in again.", (result as ApiResult.Err).error.text())
            assertNull(store.read())
            assertEquals(1, server.refreshCount())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun refreshServerFailureKeepsTheSession() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"message":"unavailable"}""").addHeader("Content-Type", "application/json"))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val result = apiCall { server.riders(store).onboarding() }
            assertEquals("The server could not refresh your session. Try again.", (result as ApiResult.Err).error.text())
            assertEquals("refresh-1", store.read()?.refreshToken)
            assertEquals(1, server.refreshCount())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun refreshTimeoutKeepsTheSessionAndDoesNotSendTheTokenAgain() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val riders = server.riders(store, timeoutSeconds = 1)
            val first = apiCall { riders.onboarding() }
            val second = apiCall { riders.onboarding() }
            assertEquals(ApiError.Timeout, (first as ApiResult.Err).error)
            assertEquals(ApiError.Network, (second as ApiResult.Err).error)
            assertEquals("refresh-1", store.read()?.refreshToken)
            assertEquals(1, server.refreshCount())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun concurrentUnauthorizedResponsesShareOneRefresh() = runTest {
        val server = MockWebServer()
        val oldTokenSeen = CountDownLatch(2)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                if (path.endsWith("/auth/session/refresh")) {
                    return session("access-2", "refresh-2")
                }
                if (request.getHeader("Authorization") == "Bearer access-1") {
                    oldTokenSeen.countDown()
                    oldTokenSeen.await(5, TimeUnit.SECONDS)
                    return MockResponse().setResponseCode(401)
                }
                return json(ONBOARDING)
            }
        }
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val riders = server.riders(store)
            val results = coroutineScope {
                List(2) { async { apiCall { riders.onboarding() } } }.awaitAll()
            }
            assertTrue(results.all { it is ApiResult.Ok })
            assertEquals("refresh-2", store.read()?.refreshToken)
            assertEquals(1, server.refreshCount())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun verifyReportsAStorageFailure() = runTest {
        val server = MockWebServer()
        server.enqueue(session("access-1", "refresh-1"))
        server.start()
        try {
            val store = RejectingSessionStore()
            val result = AuthRepository(server.auth(), store).verify("login", "+263771234567", "123456")
            assertEquals(SessionStorageException.MESSAGE, (result as ApiResult.Err).error.text())
            assertNull(store.read())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun logoutClearsTheSessionAndBiometricPreference() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(500))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val biometric = MemoryBiometricPreference()
            biometric.enable()
            AuthRepository(server.auth(), store, biometric).logout()
            assertNull(store.read())
            assertFalse(biometric.isEnabled())
            assertFalse(biometric.isDeclined())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun logoutAllUsesTheExistingEndpointAndDoesNotClearUntilConfirmed() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(500))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val biometric = MemoryBiometricPreference()
            biometric.enable()
            val auth = AuthRepository(server.auth(), store, biometric)
            val confirmed = auth.requestLogoutAll()
            assertTrue(confirmed.confirmed)
            assertEquals(204, confirmed.httpCode)
            assertEquals("/auth/session/logout-all", server.takeRequest().path)
            assertEquals("access-1", store.read()?.accessToken)
            assertTrue(biometric.isEnabled())
            val failed = auth.requestLogoutAll()
            assertFalse(failed.confirmed)
            assertEquals(500, failed.httpCode)
            assertEquals("access-1", store.read()?.accessToken)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun logoutAllNetworkFailureDoesNotReportGlobalSuccess() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.start()
        try {
            val store = MemorySessionStore(AuthSession("access-1", "refresh-1", "soon", "later"))
            val attempt = AuthRepository(server.auth(), store).requestLogoutAll()
            assertFalse(attempt.confirmed)
            assertNull(attempt.httpCode)
            assertEquals("access-1", store.read()?.accessToken)
            assertFalse(logoutAllReportsGlobalSuccess(attempt.confirmed))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun acceptRetriesTheSameIdempotencyKey() = runTest {
        val server = MockWebServer()
        val expired = json("""{"message":"This offer has expired"}""", 409)
        server.enqueue(expired)
        server.enqueue(json("""{"message":"This offer has expired"}""", 409))
        server.start()
        try {
            val riders = retrofit(server.url("/").toString(), httpClient()).create(RiderService::class.java)
            val keys = AcceptKeys()
            val first = apiCall { riders.accept("assignment-1", keys.keyFor("assignment-1")) }
            val second = apiCall { riders.accept("assignment-1", keys.keyFor("assignment-1")) }
            assertEquals("This offer has expired", (first as ApiResult.Err).error.text())
            assertEquals("This offer has expired", (second as ApiResult.Err).error.text())
            val firstKey = server.takeRequest().getHeader("Idempotency-Key")
            val secondKey = server.takeRequest().getHeader("Idempotency-Key")
            assertEquals(firstKey, secondKey)
            assertTrue(!firstKey.isNullOrBlank())
        } finally {
            server.shutdown()
        }
    }
}

private const val ONBOARDING = """{"licenceVerificationStatus":"VERIFIED","approvalStatus":"APPROVED","availability":"AVAILABLE","verifiedMotorcycleCount":1,"activeVerifiedMotorcycle":true}"""

private fun json(body: String, code: Int = 200): MockResponse {
    return MockResponse().setResponseCode(code).setBody(body).addHeader("Content-Type", "application/json")
}

private fun session(access: String, refresh: String): MockResponse {
    return json("""{"accessToken":"$access","refreshToken":"$refresh","accessTokenExpiresAt":"soon","refreshTokenExpiresAt":"later"}""")
}

private fun MockWebServer.auth(): AuthService {
    return retrofit(url("/").toString(), httpClient()).create(AuthService::class.java)
}

private fun MockWebServer.riders(store: SessionStore, timeoutSeconds: Long = 15): RiderService {
    val refreshApi = retrofit(url("/").toString(), httpClient { callTimeout(timeoutSeconds, TimeUnit.SECONDS) })
        .create(AuthService::class.java)
    val client = httpClient {
        callTimeout(timeoutSeconds, TimeUnit.SECONDS)
        addInterceptor(Interceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val token = store.read()?.accessToken
            val open = path.contains("/auth/rider/") || path.endsWith("/auth/session/refresh")
            if (open || token.isNullOrEmpty()) {
                chain.proceed(request)
            } else {
                chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
            }
        })
        authenticator(RefreshAuthenticator(store) { refreshToken ->
            performRefresh { refreshApi.refresh(RefreshRequest(refreshToken)).toSession() }
        })
    }
    return retrofit(url("/").toString(), client).create(RiderService::class.java)
}

private fun MockWebServer.refreshCount(): Int {
    var refreshes = 0
    repeat(requestCount) {
        if (takeRequest().path?.endsWith("/auth/session/refresh") == true) {
            refreshes += 1
        }
    }
    return refreshes
}

private class RejectingSessionStore : SessionStore {
    private val state = MutableStateFlow<AuthSession?>(null)
    override val session: StateFlow<AuthSession?> = state.asStateFlow()
    override fun read(): AuthSession? = state.value
    override fun write(session: AuthSession): Boolean = false
    override fun clear() {
        state.value = null
    }
}

private fun SessionResponse.toSession(): AuthSession {
    return AuthSession(accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt)
}
