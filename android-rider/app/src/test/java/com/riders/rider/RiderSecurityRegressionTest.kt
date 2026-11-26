package com.riders.rider

import com.riders.rider.core.network.RefreshAttempt
import com.riders.rider.core.network.RefreshAuthenticator
import com.riders.rider.core.network.SessionChangedException
import com.riders.rider.core.network.SessionRequest
import com.riders.rider.core.network.requireSafeApiUrl
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.MemorySessionStore
import com.riders.rider.feature.profile.domain.readBoundedPhoto
import com.riders.rider.feature.profile.domain.reasonablePhotoDimensions
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class RiderSecurityRegressionTest {
    private fun session(n: Int) = AuthSession("access-$n", "refresh-$n", "soon", "later")
    private fun unauthorized(store: MemorySessionStore): Response {
        val snapshot = store.snapshot()
        val request = Request.Builder().url("https://example.test/riders/me")
            .header("Authorization", "Bearer ${snapshot.session!!.accessToken}")
            .tag(SessionRequest::class.java, SessionRequest(snapshot.identity)).build()
        return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(401).message("Unauthorized").build()
    }

    @Test fun oldRequestCannotRetryWithAnotherAccount() {
        val store = MemorySessionStore(session(1))
        val response = unauthorized(store)
        store.clear()
        store.write(session(2))
        val auth = RefreshAuthenticator(store) { error("Must not refresh") }
        assertTrue(runCatching { auth.authenticate(null, response) }.exceptionOrNull() is SessionChangedException)
        assertEquals(session(2), store.read())
    }

    @Test fun staleRefreshCannotRestoreOrClearNewSession() {
        for (outcome in listOf(RefreshAttempt.Success(session(3)), RefreshAttempt.Rejected, RefreshAttempt.TimedOut)) {
            val store = MemorySessionStore(session(1))
            val response = unauthorized(store)
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val failure = AtomicReference<Throwable?>()
            val auth = RefreshAuthenticator(store) {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                outcome
            }
            val worker = thread { failure.set(runCatching { auth.authenticate(null, response) }.exceptionOrNull()) }
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS))
                store.clear()
                store.write(session(2))
            } finally {
                release.countDown()
                worker.join(6000)
            }
            assertFalse(worker.isAlive)
            assertTrue(failure.get() is SessionChangedException)
            assertEquals(session(2), store.read())
            assertFalse(store.refreshUncertain.value)
        }
    }

    @Test fun releaseRejectsHttpAndDebugAllowsOnlyLocalHttp() {
        requireSafeApiUrl("https://example.test", false)
        requireSafeApiUrl("http://10.0.2.2:3000", true)
        requireSafeApiUrl("http://192.168.1.20:3000", true)
        assertTrue(runCatching { requireSafeApiUrl("http://example.test", true) }.isFailure)
        assertTrue(runCatching { requireSafeApiUrl("http://127.0.0.1:3000", false) }.isFailure)
        assertTrue(runCatching { requireSafeApiUrl("https://user:password@example.test", false) }.isFailure)
    }

    @Test fun profilePhotoStreamCannotExceedLimit() {
        val exact = ByteArray(8) { 1 }
        assertArrayEquals(exact, readBoundedPhoto(ByteArrayInputStream(exact), -1, 8))
        assertNull(readBoundedPhoto(ByteArrayInputStream(ByteArray(9)), -1, 8))
        assertNull(readBoundedPhoto(ByteArrayInputStream(exact), 9, 8))
        assertFalse(reasonablePhotoDimensions(12000, 12000))
        assertTrue(reasonablePhotoDimensions(8000, 8000))
    }
}
