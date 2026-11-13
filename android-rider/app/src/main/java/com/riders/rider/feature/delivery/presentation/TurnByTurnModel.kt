package com.riders.rider.feature.delivery.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.delivery.data.GuidedRoad
import com.riders.rider.feature.delivery.data.NavigationLocationWatch
import com.riders.rider.feature.delivery.data.NavigationVoiceStore
import com.riders.rider.feature.delivery.data.PickupRouteRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.isOffRoute
import com.riders.rider.feature.delivery.domain.reliableBearing
import com.riders.rider.feature.delivery.domain.shouldReplaceGuidance
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class GuidanceTarget(
    val assignmentId: String,
    val destination: GeoPoint,
    val dropoff: Boolean,
)

@HiltViewModel
class TurnByTurnModel @Inject constructor(
    private val hub: RiderLocationHub,
    private val watch: NavigationLocationWatch,
    private val routes: PickupRouteRepository,
    private val voice: NavigationVoiceStore,
) : ViewModel() {
    private val riderState = MutableStateFlow<GpsFix?>(null)
    private val bearingState = MutableStateFlow<Float?>(null)
    private val roadState = MutableStateFlow<GuidedRoad?>(null)
    private val failedState = MutableStateFlow(false)
    private val followingState = MutableStateFlow(true)

    val rider: StateFlow<GpsFix?> = riderState.asStateFlow()
    val bearing: StateFlow<Float?> = bearingState.asStateFlow()
    val road: StateFlow<GuidedRoad?> = roadState.asStateFlow()
    val routeFailed: StateFlow<Boolean> = failedState.asStateFlow()
    val following: StateFlow<Boolean> = followingState.asStateFlow()
    val voiceEnabled: StateFlow<Boolean?> = voice.enabled.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    fun setVoiceEnabled(enabled: Boolean) {
        viewModelScope.launch { voice.setEnabled(enabled) }
    }

    private var target: GuidanceTarget? = null
    private var listenJob: Job? = null
    private var routeJob: Job? = null
    private var lastRequestAtMillis: Long? = null
    private var requesting = false

    fun start(next: GuidanceTarget) {
        val continuing = target == next && listenJob?.isActive == true
        target = next
        if (!continuing) {
            roadState.value = null
            failedState.value = false
            lastRequestAtMillis = null
            followingState.value = true
            riderState.value = hub.fresh(System.currentTimeMillis())
        }
        watch.start()
        if (listenJob?.isActive == true) {
            riderState.value?.let(::considerRoute)
            return
        }
        listenJob = viewModelScope.launch {
            hub.fixes.collect { shared ->
                val saved = shared ?: return@collect
                if (System.currentTimeMillis() - saved.atMillis > LOCATION_MAX_FIX_AGE_MS) {
                    return@collect
                }
                riderState.value = saved.fix
                reliableBearing(
                    saved.fix.speedMetresPerSecond,
                    saved.fix.bearingDegrees,
                    saved.fix.bearingAccuracyDegrees,
                )?.let { bearingState.value = it }
                considerRoute(saved.fix)
            }
        }
    }

    fun stop() {
        listenJob?.cancel()
        routeJob?.cancel()
        listenJob = null
        routeJob = null
        requesting = false
        target = null
        watch.stop()
    }

    fun follow() {
        followingState.value = true
    }

    fun stopFollowing() {
        followingState.value = false
    }

    private fun considerRoute(fix: GpsFix) {
        val active = target ?: return
        if (requesting) {
            return
        }
        val current = roadState.value
        val hasRoute = current != null && current.path.size > 1
        val offRoute = current != null && current.path.size > 1 && isOffRoute(
            GeoPoint(fix.latitude, fix.longitude),
            current.path,
            fix.accuracyMetres,
        )
        val now = System.currentTimeMillis()
        if (!shouldReplaceGuidance(hasRoute, offRoute, now, lastRequestAtMillis)) {
            return
        }
        requesting = true
        lastRequestAtMillis = now
        routeJob = viewModelScope.launch {
            try {
                val next = routes.guidance(active.assignmentId, fix, active.dropoff)
                if (!isActive || target != active) {
                    return@launch
                }
                if (next != null && next.path.size > 1) {
                    roadState.value = next
                    failedState.value = false
                } else {
                    failedState.value = true
                }
            } finally {
                requesting = false
            }
        }
    }

    override fun onCleared() {
        stop()
    }
}
