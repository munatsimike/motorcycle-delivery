package com.riders.rider.feature.availability.domain

data class GpsFix(
    val latitude: Double,
    val longitude: Double,
    val bearingDegrees: Float? = null,
    val speedMetresPerSecond: Float? = null,
    val bearingAccuracyDegrees: Float? = null,
    val accuracyMetres: Float? = null,
)

fun gpsFix(point: android.location.Location): GpsFix {
    val bearing = if (point.hasBearing()) point.bearing else null
    val speed = if (point.hasSpeed()) point.speed else null
    val bearingAccuracy = if (android.os.Build.VERSION.SDK_INT >= 26 && point.hasBearingAccuracy()) {
        point.bearingAccuracyDegrees
    } else {
        null
    }
    val accuracy = if (point.hasAccuracy()) point.accuracy else null
    return GpsFix(point.latitude, point.longitude, bearing, speed, bearingAccuracy, accuracy)
}

class LocationRelay(
    @Suppress("unused") private val persist: (GpsFix) -> Unit = {},
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private var lastConfirmedAtMillis: Long? = null
    private var lastAttemptAtMillis: Long? = null
    private var lastAttemptSucceeded = false

    suspend fun handle(active: Boolean, fix: GpsFix, upload: suspend (GpsFix) -> Boolean): Boolean {
        return handle(active, fix, ageMillis = 0L, accuracyMeters = null, upload = upload)
    }

    suspend fun handle(
        active: Boolean,
        fix: GpsFix,
        ageMillis: Long,
        accuracyMeters: Float?,
        upload: suspend (GpsFix) -> Boolean,
    ): Boolean {
        if (!active || !isDispatchUsable(ageMillis, accuracyMeters)) {
            return false
        }
        val now = clock()
        if (!shouldSendUpload(now, lastConfirmedAtMillis, lastAttemptAtMillis, lastAttemptSucceeded)) {
            return false
        }
        lastAttemptAtMillis = now
        val confirmed = upload(fix)
        lastAttemptSucceeded = confirmed
        if (confirmed) {
            lastConfirmedAtMillis = now
        }
        return confirmed
    }
}
