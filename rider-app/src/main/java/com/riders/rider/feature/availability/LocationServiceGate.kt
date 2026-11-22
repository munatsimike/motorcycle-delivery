package com.riders.rider.feature.availability

/**
 * Process-local record of the location foreground service. Freshness stays in
 * [com.riders.rider.feature.availability.domain.LocationFreshness] and never
 * stores coordinates.
 */
object LocationServiceGate {
    @Volatile private var running = false

    fun isRunning(): Boolean = running

    fun markRunning(value: Boolean) {
        running = value
    }
}
