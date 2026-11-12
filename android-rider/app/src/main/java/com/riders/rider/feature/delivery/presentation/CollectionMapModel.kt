package com.riders.rider.feature.delivery.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.delivery.data.CollectionLocationWatch
import com.riders.rider.feature.delivery.data.PickupRoad
import com.riders.rider.feature.delivery.data.PickupRouteRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.riderReachedPickup
import com.riders.rider.feature.delivery.domain.shouldRequestPickupRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class CollectionTarget(val assignmentId: String, val pickup: GeoPoint)

@HiltViewModel
class CollectionMapModel @Inject constructor(
    private val hub: RiderLocationHub,
    private val watch: CollectionLocationWatch,
    private val routes: PickupRouteRepository,
) : ViewModel() {
    private val riderState = MutableStateFlow<GpsFix?>(null)
    private val routeState = MutableStateFlow(PickupRoad(emptyList(), null, null))
    private val arrivedState = MutableStateFlow(false)
    val rider: StateFlow<GpsFix?> = riderState.asStateFlow()
    val route: StateFlow<PickupRoad> = routeState.asStateFlow()
    val arrived: StateFlow<Boolean> = arrivedState.asStateFlow()

    private var target: CollectionTarget? = null
    private var listening: Job? = null
    private var clock: Job? = null
    private var lastOrigin: GeoPoint? = null
    private var lastRequestAtMillis: Long? = null
    private var routedAssignment: String? = null

    fun activate(next: CollectionTarget) {
        if (routedAssignment != next.assignmentId || target?.pickup != next.pickup) {
            routedAssignment = next.assignmentId
            lastOrigin = null
            lastRequestAtMillis = null
            routeState.value = PickupRoad(emptyList(), null, null)
            arrivedState.value = false
        }
        target = next
        if (listening == null) {
            listening = viewModelScope.launch {
                hub.fixes.collect {
                    publishRider()
                    val current = target
                    val fix = riderState.value
                    if (current != null && fix != null) {
                        requestRoute(current, fix)
                    }
                }
            }
            clock = viewModelScope.launch {
                while (isActive) {
                    publishRider()
                    delay(5_000)
                }
            }
        }
        watch.sync()
        watch.prompt()
        publishRider()
    }

    fun deactivate() {
        listening?.cancel()
        listening = null
        clock?.cancel()
        clock = null
        watch.stop()
    }

    override fun onCleared() {
        deactivate()
    }

    private fun publishRider() {
        val shared = hub.fixes.value
        val fix = shared?.takeIf { System.currentTimeMillis() - it.atMillis in 0..LOCATION_MAX_FIX_AGE_MS }?.fix
        riderState.value = fix
        val pickup = target?.pickup
        if (!arrivedState.value && fix != null && pickup != null && riderReachedPickup(GeoPoint(fix.latitude, fix.longitude), pickup)) {
            arrivedState.value = true
        }
    }

    private fun requestRoute(current: CollectionTarget, fix: GpsFix) {
        val origin = GeoPoint(fix.latitude, fix.longitude)
        val now = System.currentTimeMillis()
        if (!shouldRequestPickupRoute(lastOrigin, origin, lastRequestAtMillis, now)) {
            return
        }
        lastRequestAtMillis = now
        viewModelScope.launch {
            val line = routes.road(current.assignmentId, fix)
            if (target?.assignmentId != current.assignmentId) {
                return@launch
            }
            if (line == null || line.line.size < 2) {
                return@launch
            }
            lastOrigin = origin
            routeState.value = line
        }
    }
}
