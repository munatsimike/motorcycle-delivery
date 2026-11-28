package com.riders.rider.feature.delivery.presentation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.isDispatchUsable
import com.riders.rider.feature.delivery.data.CollectionLocationWatch
import com.riders.rider.feature.delivery.data.PickupRouteRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.deliveryRouteKey
import com.riders.rider.feature.delivery.domain.pickupTagLabel
import com.riders.rider.feature.delivery.domain.dropoffArrivalReading
import com.riders.rider.feature.delivery.domain.isRiderDropoffRoad
import com.riders.rider.feature.delivery.domain.projectOntoPath
import com.riders.rider.feature.delivery.domain.routeCalculationFix
import com.riders.rider.feature.delivery.domain.shouldRefreshLiveMapRoute
import com.riders.rider.feature.delivery.domain.LiveMapLegKey
import com.riders.rider.feature.delivery.domain.LiveMapLegState
import com.riders.rider.feature.delivery.data.LiveMapLegStore
import com.riders.rider.feature.delivery.domain.PICKUP_ARRIVED_TAG
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@HiltViewModel
class CollectedRouteModel @Inject constructor(
    private val routes: PickupRouteRepository,
    private val hub: RiderLocationHub,
    private val watch: CollectionLocationWatch,
    private val legStore: LiveMapLegStore,
) : ViewModel() {
    var line by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    var liveLine by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    var rider by mutableStateOf<GpsFix?>(null)
        private set
    private val owner = legStore.identity()
    private var leg: LiveMapLegState? = null
    var displayPoint by mutableStateOf<GeoPoint?>(null)
        private set
    var travelHeading by mutableStateOf<Float?>(null)
        private set
    var arrivedAtDropoff by mutableStateOf(false)
        private set
    var approachLabel by mutableStateOf<String?>(null)
        private set
    var locationGranted by mutableStateOf(true)
        private set
    private var requestedKey: String? = null
    private var job: Job? = null
    private var listening: Job? = null
    private var clock: Job? = null
    private var approachJob: Job? = null
    private var followingId: String? = null
    private var followingDropoff: GeoPoint? = null
    private var followingPickup: GeoPoint? = null
    private var lastOrigin: GeoPoint? = null
    private var lastRequestAtMillis: Long? = null
    private var roadMetres: Double? = null
    private var roadSeconds: Int? = null

    fun load(assignmentId: String, pickup: GeoPoint?, dropoff: GeoPoint?) {
        if (assignmentId.isBlank() || pickup == null || dropoff == null) {
            return
        }
        val next = assignmentId + "|" + deliveryRouteKey(pickup, dropoff)
        if (requestedKey == next && (line.size > 2 || job?.isActive == true)) {
            return
        }
        val replacing = requestedKey != next
        requestedKey = next
        if (replacing) {
            line = emptyList()
        }
        job?.cancel()
        job = viewModelScope.launch {
            var road = routes.deliveryRoad(assignmentId, pickup, dropoff)
            if (road.size <= 2 && requestedKey == next) {
                delay(700)
                road = routes.deliveryRoad(assignmentId, pickup, dropoff)
            }
            if (requestedKey == next) {
                line = road
                if (road.size <= 2) {
                    requestedKey = null
                }
            }
        }
    }

    /** Follow the existing shared GPS fix and refresh the rider-to-drop-off road only after a meaningful move. */
    fun follow(assignmentId: String, dropoff: GeoPoint, pickup: GeoPoint? = null) {
        if (assignmentId.isBlank()) {
            return
        }
        val retained = legStore.get(owner, LiveMapLegKey(assignmentId, true, dropoff)) ?: return
        val changed = followingId != assignmentId || followingDropoff != dropoff || leg !== retained
        followingId = assignmentId
        followingDropoff = dropoff
        followingPickup = pickup
        arrivedAtDropoff = retained.arrived
        locationGranted = watch.hasFineLocation()
        if (changed) {
            approachJob?.cancel()
            approachJob = null
            lastOrigin = null
            lastRequestAtMillis = null
            roadMetres = null
            roadSeconds = null
            liveLine = emptyList()
            approachLabel = if (retained.arrived) PICKUP_ARRIVED_TAG else null
            leg = retained
            displayPoint = retained.point
            travelHeading = retained.heading
        }
        if (listening == null) {
            listening = viewModelScope.launch {
                hub.fixes.collect { publishRider() }
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

    fun pauseFollowing() {
        val started = listening != null
        listening?.cancel()
        listening = null
        clock?.cancel()
        clock = null
        approachJob?.cancel()
        approachJob = null
        if (started) {
            watch.stop()
        }
    }

    fun stopFollowing() {
        pauseFollowing()
        followingId = null
        followingDropoff = null
        followingPickup = null
        lastOrigin = null
        lastRequestAtMillis = null
        roadMetres = null
        roadSeconds = null
        rider = null
        liveLine = emptyList()
        leg = null
        arrivedAtDropoff = false
        approachLabel = null
        displayPoint = null
        travelHeading = null
    }

    override fun onCleared() {
        stopFollowing()
    }

    private fun publishRider() {
        if (!legStore.isCurrent(owner)) return
        val tracking = leg ?: return
        val assignmentId = followingId ?: return
        val dropoff = followingDropoff ?: return
        locationGranted = watch.hasFineLocation()
        val shared = hub.fixes.value
        val age = shared?.let { System.currentTimeMillis() - it.atMillis }
        val usable = shared != null && age != null && isDispatchUsable(age, shared.fix.accuracyMetres)
        val fix = if (usable && shared != null) shared.fix else null
        rider = fix
        val riderPoint = fix?.let { GeoPoint(it.latitude, it.longitude) }
        val reading = dropoffArrivalReading(
            rider = fix?.let { GeoPoint(it.latitude, it.longitude) },
            dropoff = dropoff,
            fixUsable = usable,
        )
        if (fix != null && shared != null && riderPoint != null) {
            tracking.update(riderPoint, shared.atMillis, fix.accuracyMetres, fix.speedMetresPerSecond,
                fix.bearingDegrees, fix.bearingAccuracyDegrees, reading, liveLine,
                legOrigin = followingPickup)
        }
        travelHeading = tracking.heading
        displayPoint = tracking.point
        arrivedAtDropoff = tracking.arrived
        approachLabel = if (arrivedAtDropoff) PICKUP_ARRIVED_TAG else pickupTagLabel(riderPoint, dropoff, roadMetres, roadSeconds)
        if (arrivedAtDropoff) {
            approachJob?.cancel()
            return
        }
        if (fix == null) {
            liveLine = emptyList()
            return
        }
        if (approachJob?.isActive == true) return
        val routeFix = routeCalculationFix(fix, age) ?: run {
            logRouteRefresh("accuracy", null, fix.accuracyMetres, null)
            return
        }
        val origin = GeoPoint(routeFix.latitude, routeFix.longitude)
        val now = System.currentTimeMillis()
        val distance = projectOntoPath(origin, liveLine)?.distanceMetres
        if (!shouldRefreshLiveMapRoute(
                lastOrigin, origin, lastRequestAtMillis, now, liveLine, routeFix.accuracyMetres,
            )) {
            logRouteRefresh("wait", distance, routeFix.accuracyMetres, null)
            return
        }
        logRouteRefresh("request", distance, routeFix.accuracyMetres, null)
        approachJob = viewModelScope.launch {
            val road = routes.approachDropoff(assignmentId, routeFix)
            if (!legStore.isCurrent(owner) || followingId != assignmentId || followingDropoff != dropoff || rider == null || arrivedAtDropoff) {
                return@launch
            }
            val accepted = isRiderDropoffRoad(road.line, origin, dropoff)
            logRouteRefresh("response", distance, routeFix.accuracyMetres, accepted)
            lastRequestAtMillis = System.currentTimeMillis()
            if (!accepted) {
                return@launch
            }
            lastOrigin = origin
            roadMetres = road.metres
            roadSeconds = road.seconds
            liveLine = road.line
            tracking.chooseHeading(road.line)
            travelHeading = tracking.heading
            approachLabel = pickupTagLabel(origin, dropoff, road.metres, road.seconds)
        }
    }
}
