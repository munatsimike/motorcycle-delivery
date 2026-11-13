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
import com.riders.rider.feature.availability.LocationServiceGate
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.gpsFix
import com.riders.rider.feature.availability.domain.isDispatchUsable
import com.riders.rider.feature.availability.domain.locationUpdatePolicy
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Screen-scoped fused updates used only while the foreground location service
 * is not already listening. Leaving the screen removes this callback and does
 * not stop [com.riders.rider.feature.availability.RiderLocationService].
 */
@Singleton
class CollectionLocationWatch @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val hub: RiderLocationHub,
) {
    private val client by lazy { LocationServices.getFusedLocationProviderClient(context) }
    private var callback: LocationCallback? = null

    fun sync() {
        if (LocationServiceGate.isRunning()) {
            stop()
            return
        }
        if (callback != null || !fineLocationGranted()) {
            return
        }
        val updates = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (LocationServiceGate.isRunning()) {
                    stop()
                    return
                }
                publish(result.lastLocation)
            }
        }
        val policy = locationUpdatePolicy()
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, policy.intervalMillis)
            .setMinUpdateIntervalMillis(policy.minIntervalMillis)
            .setMaxUpdateDelayMillis(policy.maxUpdateDelayMillis)
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

    @SuppressLint("MissingPermission")
    fun prompt() {
        if (!fineLocationGranted() || hub.fresh(System.currentTimeMillis()) != null) {
            return
        }
        try {
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { point -> publish(point) }
        } catch (_: SecurityException) {
            return
        }
    }

    fun stop() {
        val updates = callback ?: return
        callback = null
        if (fineLocationGranted()) {
            client.removeLocationUpdates(updates)
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

    fun hasFineLocation(): Boolean = fineLocationGranted()

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
