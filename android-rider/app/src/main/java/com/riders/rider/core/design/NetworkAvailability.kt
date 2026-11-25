package com.riders.rider.core.design

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

const val NETWORK_NOTICE_HOLD_MS = 2_000L

enum class NetworkLink {
    Initialising,
    Connected,
    Disconnected,
}

enum class NetworkAvailability {
    Initialising,
    Connected,
    Disconnected,
    BackendUnavailable,
}

data class NetworkLinkSnapshot(
    val link: NetworkLink,
    val downSinceMillis: Long?,
)

fun networkIsValidated(hasInternet: Boolean, validated: Boolean): Boolean = hasInternet && validated

fun onNetworkUp(snapshot: NetworkLinkSnapshot): NetworkLinkSnapshot {
    return NetworkLinkSnapshot(NetworkLink.Connected, null)
}

fun onNetworkDown(snapshot: NetworkLinkSnapshot, nowMillis: Long): NetworkLinkSnapshot {
    if (snapshot.downSinceMillis != null) {
        return snapshot
    }
    return snapshot.copy(downSinceMillis = nowMillis)
}

fun settleNetworkLink(
    snapshot: NetworkLinkSnapshot,
    nowMillis: Long,
    holdMs: Long = NETWORK_NOTICE_HOLD_MS,
): NetworkLinkSnapshot {
    val since = snapshot.downSinceMillis ?: return snapshot
    if (nowMillis - since < holdMs) {
        return snapshot
    }
    return NetworkLinkSnapshot(NetworkLink.Disconnected, since)
}

fun networkHoldRemaining(
    sinceMillis: Long?,
    nowMillis: Long,
    holdMs: Long = NETWORK_NOTICE_HOLD_MS,
): Long? {
    val since = sinceMillis ?: return null
    return (holdMs - (nowMillis - since)).coerceAtLeast(0L)
}

fun transportFailureSince(
    active: Boolean,
    nowMillis: Long,
    sinceMillis: Long?,
    link: NetworkLink,
): Long? {
    return when {
        active && sinceMillis != null -> sinceMillis
        active -> nowMillis
        link == NetworkLink.Disconnected -> sinceMillis
        else -> null
    }
}

fun classifyNetwork(
    link: NetworkLink,
    transportFailure: Boolean,
    backendFailure: Boolean,
    transportSinceMillis: Long?,
    nowMillis: Long,
    holdMs: Long = NETWORK_NOTICE_HOLD_MS,
): NetworkAvailability {
    if (link == NetworkLink.Initialising) {
        return NetworkAvailability.Initialising
    }
    if (link == NetworkLink.Disconnected) {
        return NetworkAvailability.Disconnected
    }
    if (backendFailure) {
        return NetworkAvailability.BackendUnavailable
    }
    if (!transportFailure) {
        return NetworkAvailability.Connected
    }
    val since = transportSinceMillis ?: nowMillis
    if (nowMillis - since < holdMs) {
        return NetworkAvailability.Connected
    }
    return NetworkAvailability.BackendUnavailable
}

fun showNetworkUnavailableWarning(availability: NetworkAvailability, transportFailure: Boolean): Boolean {
    return transportFailure && availability == NetworkAvailability.Disconnected
}

fun networkWarningPending(availability: NetworkAvailability, transportFailure: Boolean): Boolean {
    return transportFailure &&
        (availability == NetworkAvailability.Initialising || availability == NetworkAvailability.Connected)
}

object RiderNetwork {
    private val linkState = MutableStateFlow(NetworkLink.Initialising)
    private val transportState = MutableStateFlow<Long?>(null)
    private val revisionState = MutableStateFlow(0L)
    private val restored = MutableSharedFlow<Unit>(replay = 1, extraBufferCapacity = 1)
    val link: StateFlow<NetworkLink> = linkState.asStateFlow()
    val transportSince: StateFlow<Long?> = transportState.asStateFlow()
    val revision: StateFlow<Long> = revisionState.asStateFlow()
    val connectivityRestored: SharedFlow<Unit> = restored.asSharedFlow()

    private val handler = Handler(Looper.getMainLooper())
    private val reporters = LinkedHashMap<Any, Boolean>()
    private var snapshot = NetworkLinkSnapshot(NetworkLink.Initialising, null)
    private var transportSinceMillis: Long? = null
    private var connectivity: ConnectivityManager? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private val tick = Runnable {
        val now = SystemClock.elapsedRealtime()
        snapshot = settleNetworkLink(snapshot, now)
        linkState.value = snapshot.link
        revisionState.value = now
        arm(now)
    }

    fun ensureInstalled(context: Context) {
        if (callback != null) {
            return
        }
        val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        connectivity = manager
        val registered = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                publish(network, announceRestored = true)
            }

            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                publish(network, announceRestored = false)
            }

            override fun onLost(network: Network) {
                markDown()
            }

            override fun onUnavailable() {
                markDown()
            }
        }
        callback = registered
        val active = manager.activeNetwork
        if (active == null) {
            markDown()
        } else {
            publish(active, announceRestored = true)
        }
        manager.registerDefaultNetworkCallback(registered)
    }

    fun setReporter(id: Any, active: Boolean) {
        val changed = if (active) {
            reporters.put(id, true) == null
        } else {
            reporters.remove(id) != null
        }
        if (!changed) {
            return
        }
        val now = SystemClock.elapsedRealtime()
        val next = transportFailureSince(reporters.isNotEmpty(), now, transportSinceMillis, snapshot.link)
        if (next == transportSinceMillis) {
            return
        }
        transportSinceMillis = next
        transportState.value = next
        revisionState.value = now
        if (next != null) {
            arm(now)
        }
    }

    private fun publish(network: Network, announceRestored: Boolean) {
        val capabilities = connectivity?.getNetworkCapabilities(network)
        val validated = networkIsValidated(
            hasInternet = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
            validated = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true,
        )
        if (!validated) {
            markDown()
            return
        }
        val entered = snapshot.link != NetworkLink.Connected
        handler.removeCallbacks(tick)
        snapshot = onNetworkUp(snapshot)
        val now = SystemClock.elapsedRealtime()
        linkState.value = snapshot.link
        revisionState.value = now
        if (announceRestored || entered) {
            restored.tryEmit(Unit)
        }
    }

    private fun markDown() {
        val now = SystemClock.elapsedRealtime()
        snapshot = settleNetworkLink(onNetworkDown(snapshot, now), now)
        linkState.value = snapshot.link
        revisionState.value = now
        arm(now)
    }

    private fun arm(nowMillis: Long) {
        handler.removeCallbacks(tick)
        val waits = listOfNotNull(
            networkHoldRemaining(snapshot.downSinceMillis, nowMillis)?.takeIf { it > 0L },
            transportSinceMillis?.let { since -> networkHoldRemaining(since, nowMillis) }?.takeIf { it > 0L },
        )
        val wait = waits.minOrNull() ?: return
        handler.postDelayed(tick, wait)
    }
}
