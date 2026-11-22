package com.riders.rider.feature.availability

import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SharedFix(val fix: GpsFix, val atMillis: Long)

/**
 * Latest usable fix already produced by [RiderLocationService] or by the
 * collection screen's own short-lived watcher. This is not a second service.
 */
@Singleton
class RiderLocationHub @Inject constructor() {
    private val latest = MutableStateFlow<SharedFix?>(null)
    val fixes: StateFlow<SharedFix?> = latest.asStateFlow()

    fun publish(fix: GpsFix, atMillis: Long = System.currentTimeMillis()) {
        latest.value = SharedFix(fix, atMillis)
    }

    fun fresh(nowMillis: Long): GpsFix? {
        val shared = latest.value ?: return null
        return if (nowMillis - shared.atMillis in 0..LOCATION_MAX_FIX_AGE_MS) shared.fix else null
    }
}
