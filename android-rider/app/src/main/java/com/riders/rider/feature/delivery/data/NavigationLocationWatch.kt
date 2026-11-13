package com.riders.rider.feature.delivery.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.gpsFix
import com.riders.rider.feature.availability.domain.isDispatchUsable
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Display updates for the navigation screen. This publishes into
 * [RiderLocationHub] and does not upload a location or start another service.
 * [stop] removes the callback when navigation closes.
 */
@Singleton
class NavigationLocationWatch @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val hub: RiderLocationHub,
) {
    private val client by lazy { LocationServices.getFusedLocationProviderClient(context) }
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    fun start() {
        if (!fineLocationGranted()) {
            return
        }
        prompt()
        if (callback != null) {
            return
        }
        val updates = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                publish(result.lastLocation)
            }
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L)
            .setMinUpdateIntervalMillis(1_000L)
            .setMaxUpdateDelayMillis(1_000L)
            .setGranularity(Granularity.GRANULARITY_FINE)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            callback = updates
            client.requestLocationUpdates(request, updates, Looper.getMainLooper())
                .addOnFailureListener { stop() }
        } catch (_: SecurityException) {
            callback = null
        }
    }

    fun stop() {
        val updates = callback ?: return
        callback = null
        if (fineLocationGranted()) {
            client.removeLocationUpdates(updates)
        }
    }

    @SuppressLint("MissingPermission")
    private fun prompt() {
        try {
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { point -> publish(point) }
        } catch (_: SecurityException) {
            return
        }
    }

    private fun publish(point: Location?) {
        if (point == null) {
            return
        }
        val age = (System.currentTimeMillis() - point.time).coerceAtLeast(0L)
        val accuracy = if (point.hasAccuracy()) point.accuracy else null
        if (!isDispatchUsable(age, accuracy)) {
            return
        }
        hub.publish(gpsFix(point))
    }

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
