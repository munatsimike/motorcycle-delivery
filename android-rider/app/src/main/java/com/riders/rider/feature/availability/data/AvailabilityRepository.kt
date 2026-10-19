package com.riders.rider.feature.availability.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AvailabilityResponse
import com.riders.rider.core.network.LocationRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.availability.RiderLocationService
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationCommand
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

data class AvailabilityUpdate(val availability: String, val message: String?)

@Singleton
class AvailabilityRepository @Inject constructor(
    private val riders: RiderService,
    private val sharing: LocationSharingStore,
    private val freshness: LocationFreshness,
    @param:ApplicationContext private val context: Context,
) {
    suspend fun online(): ApiResult<AvailabilityUpdate> {
        val result = apiCall { riders.online() }.mapAvailability()
        if (result is ApiResult.Ok) {
            applySharing(result.value.availability)
        }
        return result
    }

    suspend fun offline(): ApiResult<AvailabilityUpdate> {
        val result = apiCall { riders.offline() }.mapAvailability()
        if (result is ApiResult.Ok) {
            applySharing(result.value.availability)
        }
        return result
    }

    suspend fun applySharing(availability: String) {
        val available = availability == "AVAILABLE"
        if (!available) {
            freshness.invalidate()
        }
        sharing.setEnabled(available)
        val intent = Intent(context, RiderLocationService::class.java).setAction(RiderLocationService.ACTION_SHARE)
        val permitted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (available && permitted) {
            ContextCompat.startForegroundService(context, intent)
        } else {
            context.stopService(intent)
        }
    }

    suspend fun upload(fix: GpsFix): Boolean {
        return when (val result = apiCall { riders.location(LocationRequest(fix.latitude, fix.longitude)) }) {
            is ApiResult.Ok -> {
                freshness.markConfirmed(System.currentTimeMillis())
                true
            }
            is ApiResult.Err -> {
                if (commandAfterUploadFailure(result.error) == LocationCommand.Stop) {
                    applySharing("OFFLINE")
                }
                false
            }
        }
    }
}

private fun ApiResult<AvailabilityResponse>.mapAvailability(): ApiResult<AvailabilityUpdate> {
    return when (this) {
        is ApiResult.Ok -> ApiResult.Ok(AvailabilityUpdate(value.availability, value.message))
        is ApiResult.Err -> this
    }
}
