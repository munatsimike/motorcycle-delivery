package com.riders.rider.feature.offers.notification

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.riders.rider.core.network.PushDeviceRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.session.SessionStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Singleton
class OfferPushCoordinator @Inject constructor(
    @ApplicationContext private val context: Context,
    private val riders: RiderService,
    private val sessions: SessionStore,
    private val pending: PendingOffer,
    private val shown: ShownOfferStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var registeredToken: String? = null

    fun onHome() {
        scope.launch { registerCurrentToken() }
    }

    fun onNewToken(token: String) {
        writeToken(token)
        registeredToken = null
        if (sessions.read() != null) {
            scope.launch { registerCurrentToken() }
        }
    }

    suspend fun forget() {
        val token = readToken()
        if (token != null && sessions.read() != null) {
            apiCall { riders.removePushDevice(PushDeviceRequest(token)) }
        }
        writeToken(null)
        registeredToken = null
        shown.clear()
        pending.clear()
    }

    private suspend fun registerCurrentToken() {
        if (sessions.read() == null) {
            return
        }
        val token = currentToken() ?: return
        if (token == registeredToken) {
            return
        }
        val result = apiCall { riders.registerPushDevice(PushDeviceRequest(token)) }
        if (result is com.riders.rider.core.network.ApiResult.Ok) {
            registeredToken = token
        }
    }

    private suspend fun currentToken(): String? {
        readToken()?.let { return it }
        if (!firebaseReady(context)) {
            return null
        }
        return try {
            val token = withContext(Dispatchers.IO) {
                Tasks.await(FirebaseMessaging.getInstance().token)
            }
            writeToken(token)
            token
        } catch (_: Exception) {
            null
        }
    }

    private fun readToken(): String? {
        return context.getSharedPreferences(ShownOfferStore.PREFS, Context.MODE_PRIVATE)
            .getString(ShownOfferStore.TOKEN, null)
            ?.takeIf { it.isNotBlank() }
    }

    private fun writeToken(token: String?) {
        val editor = context.getSharedPreferences(ShownOfferStore.PREFS, Context.MODE_PRIVATE).edit()
        if (token.isNullOrBlank()) {
            editor.remove(ShownOfferStore.TOKEN)
        } else {
            editor.putString(ShownOfferStore.TOKEN, token)
        }
        editor.apply()
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
