package com.riders.rider.feature.delivery.presentation

import com.google.android.gms.maps.CameraUpdate
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.maps.android.compose.CameraPositionState
import com.riders.rider.feature.delivery.domain.normalizeBearing
import com.riders.rider.feature.delivery.domain.shortestBearingDelta
import kotlin.math.abs
import kotlinx.coroutines.delay

/**
 * Turns the map along the short arc. The motorcycle bitmap stays screen-upright,
 * so this is the only rotation applied while following.
 */
/**
 * Fits the same bounds as [CameraUpdateFactory.newLatLngBounds], then puts
 * [bearing] back on that camera. The bounds update itself clears bearing.
 *
 * [CameraPositionState.move] does not update [CameraPositionState.position]
 * before it returns, so the fitted target has to be read after [animate]
 * completes. Applying the bearing to the pre-fit position leaves the map
 * where the rider had panned it.
 */
internal suspend fun showFittedCamera(
    camera: CameraPositionState,
    bounds: CameraUpdate,
    bearing: Float?,
) {
    camera.animate(bounds, 450)
    if (bearing == null) {
        return
    }
    val fitted = camera.position
    camera.move(
        CameraUpdateFactory.newCameraPosition(
            CameraPosition.Builder(fitted)
                .bearing(normalizeBearing(bearing))
                .tilt(0f)
                .build(),
        ),
    )
}

internal suspend fun animateHeadingUp(camera: CameraPositionState, target: Float) {
    val start = camera.position.bearing
    val delta = shortestBearingDelta(start, target)
    if (abs(delta) < 2f) {
        return
    }
    val steps = (abs(delta) / 45f).toInt().coerceIn(1, 4)
    val slice = 560L / steps
    for (step in 1..steps) {
        val bearing = normalizeBearing(start + delta * step / steps.toFloat())
        val position = camera.position
        camera.animate(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder(position)
                    .bearing(bearing)
                    .tilt(0f)
                    .build(),
            ),
            slice.toInt(),
        )
        delay(slice)
    }
}
