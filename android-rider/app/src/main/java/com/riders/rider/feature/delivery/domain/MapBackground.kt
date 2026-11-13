package com.riders.rider.feature.delivery.domain

import kotlin.math.ln

/**
 * Visible span for a static neighborhood map.
 * 0.027° is about 3 km, the same wide neighborhood frame the customer home map uses.
 */
const val NEIGHBORHOOD_SPAN_DEGREES = 0.027

/** Zoom that makes [spanPx] show [spanDegrees] of longitude. */
fun neighborhoodZoom(spanPx: Int, spanDegrees: Double = NEIGHBORHOOD_SPAN_DEGREES): Float {
    val pixels = spanPx.coerceAtLeast(1)
    val zoom = ln((360.0 * pixels) / (256.0 * spanDegrees)) / ln(2.0)
    return zoom.toFloat().coerceIn(3f, 21f)
}
