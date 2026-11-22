package com.riders.rider.core.session

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import java.security.GeneralSecurityException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EncryptedSessionStore @Inject constructor(
    @ApplicationContext context: Context,
) : SessionStore {
    private val preferences: SharedPreferences? = open(context)
    private val state = MutableStateFlow(readStored())
    override val session: StateFlow<AuthSession?> = state.asStateFlow()

    override fun read(): AuthSession? = state.value

    override fun write(session: AuthSession): Boolean {
        val editor = preferences?.edit() ?: return false
        return try {
            val saved = editor
                .putString(ACCESS, session.accessToken)
                .putString(REFRESH, session.refreshToken)
                .putString(ACCESS_EXPIRY, session.accessTokenExpiresAt)
                .putString(REFRESH_EXPIRY, session.refreshTokenExpiresAt)
                .commit()
            if (saved) {
                state.value = session
            }
            saved
        } catch (_: GeneralSecurityException) {
            false
        } catch (_: IOException) {
            false
        }
    }

    override fun clear() {
        preferences?.edit()?.clear()?.apply()
        state.value = null
    }

    private fun readStored(): AuthSession? {
        val stored = preferences ?: return null
        val access = stored.getString(ACCESS, null) ?: return null
        val refresh = stored.getString(REFRESH, null) ?: return null
        val accessExpiry = stored.getString(ACCESS_EXPIRY, null) ?: return null
        val refreshExpiry = stored.getString(REFRESH_EXPIRY, null) ?: return null
        if (access.isEmpty() || refresh.isEmpty()) {
            return null
        }
        return AuthSession(access, refresh, accessExpiry, refreshExpiry)
    }

    private companion object {
        const val ACCESS = "access_token"
        const val REFRESH = "refresh_token"
        const val ACCESS_EXPIRY = "access_token_expires_at"
        const val REFRESH_EXPIRY = "refresh_token_expires_at"

        fun open(context: Context): SharedPreferences? {
            return try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context,
                    "rider_session",
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (_: GeneralSecurityException) {
                null
            } catch (_: IOException) {
                null
            }
        }
    }
}
