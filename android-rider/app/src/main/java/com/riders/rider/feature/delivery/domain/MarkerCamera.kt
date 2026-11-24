package com.riders.rider.feature.delivery.domain

/**
 * Tracks overlapping camera animations. A marker added while an animation is
 * running can fail to draw until the rider gestures, so new markers wait until
 * every in-flight animation has finished. A marker that is already attached
 * stays attached through later fits.
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
