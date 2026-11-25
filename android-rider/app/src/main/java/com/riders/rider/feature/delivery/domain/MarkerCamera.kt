package com.riders.rider.feature.delivery.domain

/**
 * Tracks overlapping camera animations for the pickup and drop-off pins.
 * The motorcycle marker is not gated: it stays mounted through fits, heading
 * changes, and short gaps in the GPS fix.
 */
class MarkerCameraGate {
    private var depth = 0
    private var opened = false

    fun begin(): MarkerCameraPhase {
        depth += 1
        return phase()
    }

    fun end(): MarkerCameraPhase {
        depth = (depth - 1).coerceAtLeast(0)
        if (depth == 0) {
            opened = true
        }
        return phase()
    }

    /** A path that does not animate still releases markers once the map can draw. */
    fun settleWithoutAnimation(): MarkerCameraPhase {
        if (depth == 0) {
            opened = true
        }
        return phase()
    }

    fun phase(): MarkerCameraPhase = MarkerCameraPhase(opened && depth == 0)
}

data class MarkerCameraPhase(val acceptingNew: Boolean = false)

/** Keeps a drawn marker through later camera work. Removes it only when its data is gone. */
fun markerStaysAttached(attached: Boolean, acceptingNew: Boolean, ready: Boolean): Boolean {
    if (!ready) {
        return false
    }
    return attached || acceptingNew
}
