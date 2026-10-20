package com.riders.rider.feature.auth.data

import android.content.Context
import com.riders.rider.feature.auth.domain.BiometricPreference
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SharedBiometricPreference @Inject constructor(
    @ApplicationContext context: Context,
) : BiometricPreference {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun isEnabled(): Boolean = preferences.getBoolean(ENABLED, false)

    override fun isDeclined(): Boolean = preferences.getBoolean(DECLINED, false)

    override fun enable() {
        preferences.edit().putBoolean(ENABLED, true).putBoolean(DECLINED, false).commit()
    }

    override fun decline() {
        preferences.edit().putBoolean(DECLINED, true).commit()
    }

    override fun disable() {
        preferences.edit().putBoolean(ENABLED, false).commit()
    }

    override fun clear() {
        preferences.edit().clear().commit()
    }

    private companion object {
        const val FILE = "rider_biometric"
        const val ENABLED = "enabled"
        const val DECLINED = "declined"
    }
}
