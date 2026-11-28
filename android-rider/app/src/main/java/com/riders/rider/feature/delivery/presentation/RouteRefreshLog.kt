package com.riders.rider.feature.delivery.presentation

import android.util.Log
import com.riders.rider.BuildConfig
import java.util.Locale

/** Debug-only route decisions. Coordinates are never included. */
internal fun logRouteRefresh(
    decision: String,
    distanceMetres: Double?,
    accuracyMetres: Float?,
    accepted: Boolean?,
) {
    if (!BuildConfig.DEBUG) {
        return
    }
    val distance = distanceMetres?.let { String.format(Locale.US, "%.0f", it) } ?: "-"
    val accuracy = accuracyMetres?.let { String.format(Locale.US, "%.0f", it) } ?: "-"
    val outcome = when (accepted) {
        true -> "accepted"
        false -> "rejected"
        null -> "-"
    }
    Log.d("RouteRefresh", "decision=$decision distanceM=$distance accuracyM=$accuracy outcome=$outcome")
}
