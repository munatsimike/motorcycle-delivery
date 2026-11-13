package com.riders.rider.feature.delivery.presentation

import android.content.Context
import com.google.android.gms.maps.model.MapStyleOptions
import com.riders.rider.BuildConfig
import com.riders.rider.R

/** Base-map appearance. Delivery markers, the route, and the camera stay the same. */
enum class RiderMapTheme(val storageKey: String, val label: String) {
    ClassicLight("classic_light", "Classic Light"),
    MinimalLight("minimal_light", "Minimal Light"),
    ;

    companion object {
        fun fromKey(key: String?): RiderMapTheme {
            return entries.firstOrNull { it.storageKey == key } ?: ClassicLight
        }
    }
}

internal object RiderMapThemeStore {
    private const val PREFS = "rider_map_theme"
    private const val KEY = "theme"

    fun read(context: Context): RiderMapTheme {
        if (!BuildConfig.DEBUG) {
            return RiderMapTheme.ClassicLight
        }
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        return RiderMapTheme.fromKey(saved)
    }

    fun write(context: Context, theme: RiderMapTheme) {
        if (!BuildConfig.DEBUG) {
            return
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, theme.storageKey)
            .apply()
    }
}

internal class RiderMapStyles(
    val classic: MapStyleOptions?,
    val minimal: MapStyleOptions?,
    val dark: MapStyleOptions?,
) {
    fun optionsFor(theme: RiderMapTheme, darkMode: Boolean = false): MapStyleOptions? {
        if (darkMode) {
            return dark ?: classic
        }
        return when (theme) {
            RiderMapTheme.ClassicLight -> classic
            RiderMapTheme.MinimalLight -> minimal ?: classic
        }
    }

    companion object {
        fun load(context: Context): RiderMapStyles {
            val classic = runCatching {
                MapStyleOptions.loadRawResourceStyle(context, R.raw.collection_map_style)
            }.getOrNull()
            val minimal = runCatching {
                MapStyleOptions.loadRawResourceStyle(context, R.raw.rider_map_minimal_light)
            }.getOrNull()
            val dark = runCatching {
                MapStyleOptions.loadRawResourceStyle(context, R.raw.rider_map_dark)
            }.getOrNull()
            return RiderMapStyles(classic, minimal, dark)
        }
    }
}
