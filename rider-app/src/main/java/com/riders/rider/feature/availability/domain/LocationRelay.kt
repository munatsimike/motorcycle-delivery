package com.riders.rider.feature.availability.domain

data class GpsFix(val latitude: Double, val longitude: Double)

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
