package com.riders.rider.feature.offers.notification

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.PushDeviceRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.offers.domain.canRemovePushDevice
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@Singleton
class OfferPushCoordinator @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val riders: RiderService,
    private val sessions: SessionStore,
    private val pending: PendingOffer,
    private val shown: ShownOfferStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var registeredToken: String? = null
    private val registrationLock = Mutex()
    private val tokenLock = Any()
    private var tokenGeneration = 0L
    private val prefs = context.getSharedPreferences(ShownOfferStore.PREFS, Context.MODE_PRIVATE)
    private val ownerKey = "registered_session"
    private val tokenPrefs by lazy { com.riders.rider.core.session.privateCache(context, "rider_push_private") }
    fun canReceive(identity: String): Boolean = sessions.isCurrent(identity) && prefs.getString(ownerKey, null) == identity
    private fun cancelDeliveryNotifications() {
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            manager.activeNotifications.filter { it.notification.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE == 0 }
                .forEach { manager.cancel(it.tag, it.id) }
        }
    }
    fun resetRegistration(clearNotifications: Boolean = false) {
        registeredToken = null
        if (!clearNotifications) return
        prefs.edit().remove(ownerKey).apply()
        cancelDeliveryNotifications()
        shown.clear()
        pending.clear()
        pending.clearAccepted()
        pending.clearCustomerCancelled()
        pending.clearApproval()
    }

    fun onHome() {
        scope.launch { registerCurrentToken() }
    }

    fun onNewToken(token: String) {
        synchronized(tokenLock) {
            tokenGeneration++
            writeToken(token)
            registeredToken = null
        }
        if (sessions.read() != null) {
            scope.launch { registerCurrentToken() }
        }
    }

    suspend fun forget() = registrationLock.withLock {
        val token = readToken()
        val identity = sessions.snapshot().identity
        val signedIn = sessions.isCurrent(identity)
        if (canRemovePushDevice(signedIn, token) && token != null) {
            val removed = apiCall { riders.removePushDevice(PushDeviceRequest(token)) }
            if (removed is ApiResult.Ok && sessions.isCurrent(identity)) {
                writeToken(null)
                registeredToken = null
            }
        } else if (!signedIn) {
            writeToken(null)
            registeredToken = null
        }
        if (sessions.snapshot().identity == identity) resetRegistration(clearNotifications = true)
    }

    private suspend fun registerCurrentToken() {
        registrationLock.withLock {
            if (sessions.read() == null) {
                return
            }
            val identity = sessions.snapshot().identity
            val token = currentToken() ?: return
            if (!sessions.isCurrent(identity)) return
            if (token == registeredToken && canReceive(identity)) {
                return
            }
            val result = apiCall { riders.registerPushDevice(PushDeviceRequest(token)) }
            synchronized(sessions) {
                if (result is ApiResult.Ok && sessions.isCurrent(identity) && readToken() == token) {
                    registeredToken = token
                    prefs.edit().putString(ownerKey, identity).apply()
                }
            }
        }
    }

    private suspend fun currentToken(): String? {
        val generation = synchronized(tokenLock) {
            readToken()?.let { return it }
            tokenGeneration
        }
        if (!firebaseReady(context)) return null
        return try {
            val token = withTimeoutOrNull(15_000L) {
                suspendCancellableCoroutine<String> { continuation ->
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        if (task.isSuccessful) continuation.resume(task.result)
                        else continuation.resumeWithException(task.exception ?: IllegalStateException("FCM token unavailable"))
                    }
                }
            } ?: return null
            synchronized(tokenLock) {
                // A token refresh may have arrived while Firebase was resolving the token.
                if (tokenGeneration != generation) readToken()
                else {
                    writeToken(token)
                    token
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        }
    }

    private fun readToken(): String? = runCatching {
        val legacy = prefs.getString(ShownOfferStore.TOKEN, null)
        if (legacy != null) {
            if (!tokenPrefs.contains(ShownOfferStore.TOKEN)) {
                if (!tokenPrefs.edit().putString(ShownOfferStore.TOKEN, legacy).commit()) return@runCatching null
            }
            prefs.edit().remove(ShownOfferStore.TOKEN).apply()
        }
        tokenPrefs.getString(ShownOfferStore.TOKEN, null)?.takeIf { it.isNotBlank() }
    }.getOrNull()

    private fun writeToken(token: String?) {
        runCatching {
            val editor = tokenPrefs.edit()
            if (token.isNullOrBlank()) editor.remove(ShownOfferStore.TOKEN)
            else editor.putString(ShownOfferStore.TOKEN, token)
            if (editor.commit()) prefs.edit().remove(ShownOfferStore.TOKEN).apply()
        }
    }
}

fun firebaseReady(context: Context): Boolean {
    return try {
        FirebaseApp.getApps(context).isNotEmpty()
    } catch (_: Exception) {
        false
    }
}

fun notificationPermissionWasAsked(context: Context): Boolean {
    return context.getSharedPreferences(ShownOfferStore.PREFS, Context.MODE_PRIVATE)
        .getBoolean(ShownOfferStore.PERMISSION_ASKED, false)
}

fun markNotificationPermissionAsked(context: Context) {
    context.getSharedPreferences(ShownOfferStore.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(ShownOfferStore.PERMISSION_ASKED, true)
        .apply()
}
