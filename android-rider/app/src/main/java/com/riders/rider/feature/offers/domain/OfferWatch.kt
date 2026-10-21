package com.riders.rider.feature.offers.domain

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

class OfferRefreshGate {
    private val lock = Mutex()

    suspend fun run(block: suspend () -> Unit) {
        if (!lock.tryLock()) {
            return
        }
        try {
            block()
        } finally {
            lock.unlock()
        }
    }
}

class OfferWatch(
    private val scope: CoroutineScope,
    private val refresh: suspend () -> Unit,
    private val tick: () -> Unit,
    private val refreshIntervalMs: Long = OFFER_REFRESH_INTERVAL_MS,
    private val clockIntervalMs: Long = OFFER_CLOCK_INTERVAL_MS,
) {
    private var job: Job? = null

    val running: Boolean
        get() = job?.isActive == true

    fun setResumed(resumed: Boolean) {
        if (resumed && running) {
            return
        }
        job?.cancel()
        job = null
        if (!shouldPollOffers(resumed)) {
            return
        }
        job = scope.launch {
            val clock = launch {
                while (isActive) {
                    tick()
                    delay(clockIntervalMs)
                }
            }
            try {
                while (isActive) {
                    refresh()
                    delay(refreshIntervalMs)
                }
            } finally {
                clock.cancel()
            }
        }
    }
}
