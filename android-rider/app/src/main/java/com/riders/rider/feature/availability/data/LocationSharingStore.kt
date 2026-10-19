package com.riders.rider.feature.availability.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

private val Context.locationSharing by preferencesDataStore(name = "rider_location_sharing")

@Singleton
class LocationSharingStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    suspend fun setEnabled(enabled: Boolean) {
        context.locationSharing.edit { prefs ->
            prefs[Enabled] = enabled
        }
    }

    private companion object {
        val Enabled = booleanPreferencesKey("location_sharing_enabled")
    }
}
