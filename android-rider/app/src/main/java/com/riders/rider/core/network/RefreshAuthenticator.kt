package com.riders.rider.core.network

import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.domain.DeviceReplacementNotice
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
 * A timeout or a dropped connection is therefore uncertain: the stored session is kept, that
 * refresh token is not sent again, and the rider can sign in to replace it. The marker is stored
 * with the session so a new process does not send the same token.
 *
 * A completed HTTP 5xx is different. The transaction only returns a new pair after it commits, so
 * an error response means no replacement was issued. A later user action may try refresh again.
 * Only HTTP 401 clears the persisted session.
 */
sealed interface RefreshAttempt {
    data class Success(val session: AuthSession) : RefreshAttempt
    data object Rejected : RefreshAttempt
    data object Replaced : RefreshAttempt
    data object Unavailable : RefreshAttempt
    data object TimedOut : RefreshAttempt
    data object Unreachable : RefreshAttempt
    data object Uncertain : RefreshAttempt
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
        if (error.code() == 401) {
            val message = runCatching { error.response()?.errorBody()?.string() }.getOrNull()
            if (apiMessage(message) == DeviceReplacementNotice.MESSAGE) {
                RefreshAttempt.Replaced
            } else {
                RefreshAttempt.Rejected
            }
        } else {
            RefreshAttempt.Unavailable
        }
    } catch (error: IOException) {
        if (error.isTransportTimeout()) RefreshAttempt.TimedOut else RefreshAttempt.Unreachable
    }
}

class RefreshAuthenticator(
    private val store: SessionStore,
    private val refresh: suspend (String) -> RefreshAttempt,
) : Authenticator {
    private val mutex = Mutex()
    private var unsaved: com.riders.rider.core.session.SessionSnapshot? = null

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null
        val failed = response.request.header("Authorization") ?: return null
        val id = response.request.tag(SessionRequest::class.java)?.identity ?: return null
        val session = runBlocking {
            mutex.withLock {
                val snapshot = store.snapshot()
                val current = snapshot.session ?: throw SessionChangedException()
                if (snapshot.identity != id) throw SessionChangedException()
                if (failed != "Bearer ${current.accessToken}") return@withLock current
                if (unsaved == snapshot) throw SessionStorageException()
                if (store.refreshUncertain.value) throw RefreshRecoverableException(RefreshAttempt.Uncertain)
                val attempt = refresh(current.refreshToken)
                synchronized(store) {
                    if (store.snapshot() != snapshot) throw SessionChangedException()
                    when (attempt) {
                        is RefreshAttempt.Success -> {
                            if (!store.replaceIfCurrent(snapshot, attempt.session)) {
                                unsaved = snapshot
                                store.markUncertainIfCurrent(snapshot)
                                throw SessionStorageException()
                            }
                            attempt.session
                        }
                        RefreshAttempt.Rejected -> { store.clearIfCurrent(id); null }
                        RefreshAttempt.Replaced -> {
                            DeviceReplacementNotice.remember()
                            store.clearIfCurrent(id)
                            null
                        }
                        RefreshAttempt.TimedOut, RefreshAttempt.Unreachable -> {
                            store.markUncertainIfCurrent(snapshot)
                            throw RefreshRecoverableException(attempt)
                        }
                        RefreshAttempt.Unavailable, RefreshAttempt.Uncertain -> throw RefreshRecoverableException(attempt)
                    }
                }
            }
        } ?: return null
        if (!store.isCurrent(id)) throw SessionChangedException()
        return response.request.newBuilder().header("Authorization", "Bearer ${session.accessToken}").build()
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
