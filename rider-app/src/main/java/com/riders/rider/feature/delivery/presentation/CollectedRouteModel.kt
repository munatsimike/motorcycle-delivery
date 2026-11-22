package com.riders.rider.feature.delivery.presentation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.delivery.data.CollectionLocationWatch
import com.riders.rider.feature.delivery.data.PickupRouteRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.deliveryRouteKey
import com.riders.rider.feature.delivery.domain.isRiderDropoffRoad
import com.riders.rider.feature.delivery.domain.shouldRequestPickupRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import android.util.Log
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@HiltViewModel
class CollectedRouteModel @Inject constructor(
    private val routes: PickupRouteRepository,
    private val hub: RiderLocationHub,
    private val watch: CollectionLocationWatch,
) : ViewModel() {
    var line by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    var liveLine by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    var rider by mutableStateOf<GpsFix?>(null)
        private set
    private var requestedKey: String? = null
    private var job: Job? = null
    private var listening: Job? = null
    private var clock: Job? = null
    private var followingId: String? = null
    private var followingDropoff: GeoPoint? = null
    private var lastOrigin: GeoPoint? = null
    private var lastRequestAtMillis: Long? = null

    fun load(assignmentId: String, pickup: GeoPoint?, dropoff: GeoPoint?) {
        if (assignmentId.isBlank() || pickup == null || dropoff == null) {
            return
        }
        val next = assignmentId + "|" + deliveryRouteKey(pickup, dropoff)
        if (requestedKey == next && line.size > 2) {
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
                Log.i("CollectedRoute", "points=${road.size}")
                if (road.size <= 2) {
                    requestedKey = null
                }
            }
        }
    }

    /** Follow the existing shared GPS fix and refresh the rider-to-drop-off road only after a meaningful move. */
    fun follow(assignmentId: String, dropoff: GeoPoint) {
        if (assignmentId.isBlank()) {
            return
        }
        val changed = followingId != assignmentId || followingDropoff != dropoff
        followingId = assignmentId
        followingDropoff = dropoff
        if (changed) {
            lastOrigin = null
            lastRequestAtMillis = null
            liveLine = emptyList()
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

    fun stopFollowing() {
        val started = listening != null
        listening?.cancel()
        listening = null
        clock?.cancel()
        clock = null
        if (started) {
            watch.stop()
        }
        followingId = null
        followingDropoff = null
        lastOrigin = null
        lastRequestAtMillis = null
        rider = null
        liveLine = emptyList()
    }

    override fun onCleared() {
        stopFollowing()
    }

    private fun publishRider() {
        val assignmentId = followingId ?: return
        val dropoff = followingDropoff ?: return
        val shared = hub.fixes.value
        val fix = shared?.takeIf { System.currentTimeMillis() - it.atMillis in 0..LOCATION_MAX_FIX_AGE_MS }?.fix
        rider = fix
        if (fix == null) {
            liveLine = emptyList()
            return
        }
        val origin = GeoPoint(fix.latitude, fix.longitude)
        val now = System.currentTimeMillis()
        if (!shouldRequestPickupRoute(lastOrigin, origin, lastRequestAtMillis, now)) {
            return
        }
        lastRequestAtMillis = now
        viewModelScope.launch {
            val road = routes.approachDropoff(assignmentId, fix)
            if (followingId != assignmentId || followingDropoff != dropoff || rider == null) {
                return@launch
            }
            if (!isRiderDropoffRoad(road, origin, dropoff)) {
                return@launch
            }
            lastOrigin = origin
            liveLine = road
        }
    }
}
