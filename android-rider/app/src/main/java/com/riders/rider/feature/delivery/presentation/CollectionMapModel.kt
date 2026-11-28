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
import com.riders.rider.feature.delivery.domain.projectOntoPath
import com.riders.rider.feature.delivery.domain.riderReachedPickup
import com.riders.rider.feature.delivery.domain.routeCalculationFix
import com.riders.rider.feature.delivery.domain.shouldRefreshLiveMapRoute
import com.riders.rider.feature.delivery.domain.LiveMapLegKey
import com.riders.rider.feature.delivery.domain.LiveMapLegState
import com.riders.rider.feature.delivery.data.LiveMapLegStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
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
    private val legStore: LiveMapLegStore,
) : ViewModel() {
    private val riderState = MutableStateFlow<GpsFix?>(null)
    private val routeState = MutableStateFlow(PickupRoad(emptyList(), null, null))
    private val arrivedState = MutableStateFlow(false)
    private val owner = legStore.identity()
    private var leg: LiveMapLegState? = null
    private var routeFix: GpsFix? = null
    private val displayPointState = MutableStateFlow<GeoPoint?>(null)
    val displayPoint: StateFlow<GeoPoint?> = displayPointState.asStateFlow()
    private val headingState = MutableStateFlow<Float?>(null)
    val travelHeading: StateFlow<Float?> = headingState.asStateFlow()
    val rider: StateFlow<GpsFix?> = riderState.asStateFlow()
    val route: StateFlow<PickupRoad> = routeState.asStateFlow()
    val arrived: StateFlow<Boolean> = arrivedState.asStateFlow()

    private var target: CollectionTarget? = null
    private var listening: Job? = null
    private var clock: Job? = null
    private var routeJob: Job? = null
    private var routedPickup: GeoPoint? = null
    private var lastOrigin: GeoPoint? = null
    private var lastRequestAtMillis: Long? = null
    private var routedAssignment: String? = null

    fun activate(next: CollectionTarget) {
        val retained = legStore.get(owner, LiveMapLegKey(next.assignmentId, false, next.pickup)) ?: return
        if (routedAssignment != next.assignmentId || routedPickup != next.pickup || leg !== retained) {
            routeJob?.cancel()
            routeJob = null
            routedAssignment = next.assignmentId
            routedPickup = next.pickup
            lastOrigin = null
            lastRequestAtMillis = null
            routeState.value = PickupRoad(emptyList(), null, null)
            leg = retained
            arrivedState.value = retained.arrived
            displayPointState.value = retained.point
            routeFix = null
            headingState.value = retained.heading
        }
        target = next
        if (listening == null) {
            listening = viewModelScope.launch {
                hub.fixes.collect {
                    publishRider()
                    considerRoute()
                }
            }
            clock = viewModelScope.launch {
                while (isActive) {
                    publishRider()
                    considerRoute()
                    delay(5_000)
                }
            }
        }
        watch.sync()
        watch.prompt()
        publishRider()
        considerRoute()
    }

    fun deactivate() {
        listening?.cancel()
        listening = null
        clock?.cancel()
        clock = null
        routeJob?.cancel()
        routeJob = null
        watch.stop()
    }

    override fun onCleared() {
        deactivate()
    }

    private fun publishRider() {
        if (!legStore.isCurrent(owner)) return
        val tracking = leg ?: return
        val shared = hub.fixes.value
        val fix = shared?.takeIf { System.currentTimeMillis() - it.atMillis in 0..LOCATION_MAX_FIX_AGE_MS }?.fix
        riderState.value = fix
        val pickup = target?.pickup
        if (shared != null && fix != null) {
            val point = GeoPoint(fix.latitude, fix.longitude)
            val wasArrived = tracking.arrived
            val atPickup = wasArrived || (pickup != null && riderReachedPickup(point, pickup))
            tracking.update(point, shared.atMillis, fix.accuracyMetres, fix.speedMetresPerSecond,
                fix.bearingDegrees, fix.bearingAccuracyDegrees, atPickup, routeState.value.line)
            headingState.value = tracking.heading
            displayPointState.value = tracking.point
            routeFix = routeCalculationFix(fix, System.currentTimeMillis() - shared.atMillis)
            arrivedState.value = tracking.arrived
            if (!wasArrived && tracking.arrived) routeJob?.cancel()
        } else {
            routeFix = null
        }
    }

    private fun considerRoute() {
        val current = target ?: return
        val fix = routeFix ?: return
        if (riderState.value == null) return
        requestRoute(current, fix)
    }

    private fun requestRoute(current: CollectionTarget, fix: GpsFix) {
        if (arrivedState.value || routeJob?.isActive == true) return
        val origin = GeoPoint(fix.latitude, fix.longitude)
        val now = System.currentTimeMillis()
        val line = routeState.value.line
        val distance = projectOntoPath(origin, line)?.distanceMetres
        if (!shouldRefreshLiveMapRoute(
                lastOrigin, origin, lastRequestAtMillis, now, line, fix.accuracyMetres,
            )) {
            logRouteRefresh("wait", distance, fix.accuracyMetres, null)
            return
        }
        logRouteRefresh("request", distance, fix.accuracyMetres, null)
        routeJob = viewModelScope.launch {
            val road = routes.road(current.assignmentId, fix)
            if (!legStore.isCurrent(owner) || target != current || arrivedState.value || listening == null) {
                return@launch
            }
            val accepted = road != null && road.line.size >= 2
            logRouteRefresh("response", distance, fix.accuracyMetres, accepted)
            lastRequestAtMillis = System.currentTimeMillis()
            if (road == null || road.line.size < 2) {
                return@launch
            }
            lastOrigin = origin
            routeState.value = road
            leg?.chooseHeading(road.line)
            headingState.value = leg?.heading
        }
    }
}
