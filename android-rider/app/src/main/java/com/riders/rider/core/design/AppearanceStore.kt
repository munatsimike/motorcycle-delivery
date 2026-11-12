package com.riders.rider.core.design

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.appearance by preferencesDataStore(name = "rider_appearance")

enum class AppearanceMode {
    SYSTEM,
    LIGHT,
    DARK,
}

@Singleton
class AppearanceStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    val mode: Flow<AppearanceMode> = context.appearance.data.map { prefs ->
        when (prefs[Key]) {
            "light" -> AppearanceMode.LIGHT
            "dark" -> AppearanceMode.DARK
            else -> AppearanceMode.SYSTEM
        }
    }

    suspend fun setMode(mode: AppearanceMode) {
        val stored = when (mode) {
            AppearanceMode.LIGHT -> "light"
            AppearanceMode.DARK -> "dark"
            AppearanceMode.SYSTEM -> "system"
        }
        context.appearance.edit { prefs -> prefs[Key] = stored }
    }

    private companion object {
        val Key = stringPreferencesKey("appearance_mode")
    }
}
