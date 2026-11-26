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
import com.google.android.gms.tasks.CancellationTokenSource
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
    private var promptToken: CancellationTokenSource? = null

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
                if (callback === this) publish(result.lastLocation)
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
                .addOnFailureListener { if (callback === updates) stop() }
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
            if (promptToken != null) return
            val token = CancellationTokenSource()
            promptToken = token
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
                .addOnSuccessListener { point ->
                    if (promptToken === token) publish(point)
                }
                .addOnCompleteListener { if (promptToken === token) promptToken = null }
        } catch (_: SecurityException) {
            promptToken?.cancel()
            promptToken = null
            return
        }
    }

    fun stop() {
        promptToken?.cancel()
        promptToken = null
        val updates = callback ?: return
        callback = null
        try {
            client.removeLocationUpdates(updates)
        } catch (_: SecurityException) {
            // Permission may have been revoked while the screen was open.
        }
    }

    private fun publish(point: Location?) {
        if (point == null || !fineLocationGranted()) {
            return
        }
        val age = System.currentTimeMillis() - point.time
        val accuracy = if (point.hasAccuracy()) point.accuracy else null
        if (!isDispatchUsable(age, accuracy)) {
            return
        }
        hub.publish(gpsFix(point), point.time)
    }

    fun hasFineLocation(): Boolean = fineLocationGranted()

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
