package com.riders.rider.core.network

import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import retrofit2.HttpException
import java.io.IOException
import java.io.InterruptedIOException

/**
 * One attempt to exchange a refresh token at `POST /auth/session/refresh`.
 *
 * The backend rotates that token inside a single database transaction: it revokes the presented
 * session, inserts the replacement, then records the replacement id. When the transaction commits
 * and the HTTP response is lost, the client still holds the old refresh token. Sending that token
 * again is reuse. The backend then revokes every active session in the family, including the
 * replacement this client never received. The API has no way to look that replacement up.
 * A timeout or a dropped connection is therefore not recoverable here: the stored session is kept,
 * and that refresh token is not sent again.
 *
 * A completed HTTP 5xx is different. The transaction only returns a new pair after it commits, so
 * an error response means no replacement was issued. A later user action may try refresh again.
 * Only HTTP 401 clears the persisted session.
 */
sealed interface RefreshAttempt {
    data class Success(val session: AuthSession) : RefreshAttempt
    data object Rejected : RefreshAttempt
    data object Unavailable : RefreshAttempt
    data object TimedOut : RefreshAttempt
    data object Unreachable : RefreshAttempt
}

class RefreshRecoverableException(val failure: RefreshAttempt) : IOException()

class SessionStorageException : IOException(MESSAGE) {
    companion object {
        const val MESSAGE = "Your session could not be saved on this device."
    }
}

suspend fun performRefresh(call: suspend () -> AuthSession): RefreshAttempt {
    return try {
        RefreshAttempt.Success(call())
    } catch (error: HttpException) {
        if (error.code() == 401) RefreshAttempt.Rejected else RefreshAttempt.Unavailable
    } catch (error: IOException) {
        if (error.isTransportTimeout()) RefreshAttempt.TimedOut else RefreshAttempt.Unreachable
    }
}

class RefreshAuthenticator(
    private val store: SessionStore,
    private val refresh: suspend (String) -> RefreshAttempt,
) : Authenticator {
    private val mutex = Mutex()
    private var flight: Flight? = null
    private var blockedRefreshToken: String? = null
    private var unsavedRefreshToken: String? = null

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) {
            return null
        }
        val failedAuthorization = response.request.header("Authorization") ?: return null
        val session = runBlocking {
            val current = store.read() ?: return@runBlocking null
            if (failedAuthorization != "Bearer ${current.accessToken}") {
                return@runBlocking current
            }
            if (unsavedRefreshToken == current.refreshToken) {
                throw SessionStorageException()
            }
            when (val attempt = singleFlight(current.refreshToken)) {
                is RefreshAttempt.Success -> {
                    if (!store.write(attempt.session)) {
                        rememberUnsaved(current.refreshToken)
                        throw SessionStorageException()
                    }
                    attempt.session
                }
                RefreshAttempt.Rejected -> {
                    store.clear()
                    null
                }
                RefreshAttempt.Unavailable,
                RefreshAttempt.TimedOut,
                RefreshAttempt.Unreachable,
                -> throw RefreshRecoverableException(attempt)
            }
        } ?: return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer ${session.accessToken}")
            .build()
    }

    private suspend fun singleFlight(refreshToken: String): RefreshAttempt {
        val decision = mutex.withLock {
            if (blockedRefreshToken == refreshToken) {
                return@withLock Decision.Ready(RefreshAttempt.Unreachable)
            }
            val current = flight
            if (current != null && current.token == refreshToken) {
                Decision.Join(current.deferred)
            } else {
                val created = Flight(refreshToken, CompletableDeferred())
                flight = created
                Decision.Lead(created.deferred)
            }
        }
        return when (decision) {
            is Decision.Ready -> decision.attempt
            is Decision.Join -> decision.deferred.await()
            is Decision.Lead -> lead(refreshToken, decision.deferred)
        }
    }

    private suspend fun lead(refreshToken: String, deferred: CompletableDeferred<RefreshAttempt>): RefreshAttempt {
        val attempt = try {
            refresh(refreshToken)
        } catch (error: Throwable) {
            deferred.completeExceptionally(error)
            mutex.withLock {
                if (flight?.deferred === deferred) {
                    flight = null
                }
            }
            throw error
        }
        if (attempt is RefreshAttempt.TimedOut || attempt is RefreshAttempt.Unreachable) {
            mutex.withLock { blockedRefreshToken = refreshToken }
        }
        deferred.complete(attempt)
        mutex.withLock {
            if (flight?.deferred === deferred) {
                flight = null
            }
        }
        return attempt
    }

    private suspend fun rememberUnsaved(refreshToken: String) {
        mutex.withLock { unsavedRefreshToken = refreshToken }
    }

    private class Flight(val token: String, val deferred: CompletableDeferred<RefreshAttempt>)

    private sealed interface Decision {
        data class Ready(val attempt: RefreshAttempt) : Decision
        data class Join(val deferred: CompletableDeferred<RefreshAttempt>) : Decision
        data class Lead(val deferred: CompletableDeferred<RefreshAttempt>) : Decision
    }
}

private fun responseCount(response: Response): Int {
    var count = 1
    var prior = response.priorResponse
    while (prior != null) {
        count += 1
        prior = prior.priorResponse
    }
    return count
}

private fun IOException.isTransportTimeout(): Boolean {
    var current: Throwable? = this
    var depth = 0
    while (current != null && depth < 8) {
        if (current is InterruptedIOException) {
            return true
        }
        current = current.cause
        depth += 1
    }
    return false
}
