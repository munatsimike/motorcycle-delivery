package com.riders.rider.feature.availability

/**
 * Process-local record of the location foreground service. Freshness stays in
 * [com.riders.rider.feature.availability.domain.LocationFreshness] and never
 * stores coordinates.
 */
object LocationServiceGate {
    @Volatile private var running = false
    @Volatile private var ticket = 0
    @Volatile private var failedTicket = 0
    @Volatile private var stoppedTicket = 0

    fun isRunning(): Boolean = running

    fun currentTicket(): Int = ticket

    fun beginStart(): Int {
        ticket += 1
        failedTicket = 0
        stoppedTicket = 0
        return ticket
    }

    fun confirmRunning(startTicket: Int) {
        if (startTicket != ticket) {
            return
        }
        failedTicket = 0
        stoppedTicket = 0
        running = true
    }

    fun fail(startTicket: Int) {
        if (startTicket != ticket) {
            return
        }
        failedTicket = startTicket
        running = false
    }

    fun markStopped(startTicket: Int) {
        if (startTicket != ticket) {
            return
        }
        stoppedTicket = startTicket
        running = false
    }

    fun isFailed(startTicket: Int): Boolean {
        return startTicket != 0 && failedTicket == startTicket && startTicket == ticket
    }

    fun isStopped(startTicket: Int): Boolean {
        return startTicket != 0 && stoppedTicket == startTicket && startTicket == ticket
    }

    /** A stop from an older service must not cancel a start that replaced it. */
    fun applies(startTicket: Int): Boolean {
        return startTicket == ticket
    }
}
