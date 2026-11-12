package com.riders.rider.feature.delivery.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.navigationVoice by preferencesDataStore(name = "rider_navigation_voice")

@Singleton
class NavigationVoiceStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    val enabled: Flow<Boolean> = context.navigationVoice.data.map { prefs ->
        prefs[Key] ?: true
    }

    suspend fun setEnabled(enabled: Boolean) {
        context.navigationVoice.edit { prefs -> prefs[Key] = enabled }
    }

    private companion object {
        val Key = booleanPreferencesKey("voice_enabled")
    }
}
