package com.riders.rider.feature.availability.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.gpsFix
import com.riders.rider.feature.availability.domain.isDispatchUsable
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

data class CurrentFix(
    val fix: GpsFix,
    val ageMillis: Long,
    val accuracyMeters: Float?,
)

@Singleton
class FusedCurrentFix @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    private val client by lazy { LocationServices.getFusedLocationProviderClient(context) }

    /** Last cached fix only. Does not request a new GPS update. */
    @SuppressLint("MissingPermission")
    suspend fun cached(): GpsFix? {
        if (!locationGranted()) {
            return null
        }
        val location = suspendCancellableCoroutine<Location?> { continuation ->
            try {
                client.lastLocation
                    .addOnSuccessListener { point ->
                        if (continuation.isActive) {
                            continuation.resume(point)
                        }
                    }
                    .addOnFailureListener {
                        if (continuation.isActive) {
                            continuation.resume(null)
                        }
                    }
            } catch (_: SecurityException) {
                if (continuation.isActive) {
                    continuation.resume(null)
                }
            }
        } ?: return null
        return gpsFix(location)
    }

    suspend fun read(): CurrentFix? {
        if (!fineLocationGranted() || !providersEnabled()) {
            return null
        }
        val point = currentLocation() ?: return null
        val age = (System.currentTimeMillis() - point.time).coerceAtLeast(0L)
        val accuracy = if (point.hasAccuracy()) point.accuracy else null
        if (!isDispatchUsable(age, accuracy)) {
            return null
        }
        return CurrentFix(gpsFix(point), age, accuracy)
    }

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun locationGranted(): Boolean {
        return fineLocationGranted() ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun providersEnabled(): Boolean {
        val manager = context.getSystemService(LocationManager::class.java) ?: return false
        return runCatching {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
    }

    private suspend fun currentLocation(): Location? {
        return suspendCancellableCoroutine { continuation ->
            val token = CancellationTokenSource()
            continuation.invokeOnCancellation { token.cancel() }
            try {
                client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, token.token)
                    .addOnSuccessListener { point ->
                        if (continuation.isActive) {
                            continuation.resume(point)
                        }
                    }
                    .addOnFailureListener {
                        if (continuation.isActive) {
                            continuation.resume(null)
                        }
                    }
            } catch (_: SecurityException) {
                if (continuation.isActive) {
                    continuation.resume(null)
                }
            }
        }
    }
}
