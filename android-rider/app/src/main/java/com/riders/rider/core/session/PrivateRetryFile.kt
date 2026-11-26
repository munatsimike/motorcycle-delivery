package com.riders.rider.core.session

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.IOException

/** JWT subject is a local storage namespace only, never an authorization decision. */
class PrivateRetryFile(context: Context, name: String, private val sessions: SessionStore) {
    private val prefs by lazy { privateCache(context, name) }
    data class Owner(val identity: String, val key: String)

    fun owner(): Owner {
        val snapshot = sessions.snapshot()
        val token = snapshot.session?.accessToken ?: throw IOException("Session ended")
        val subject = runCatching {
            val payload = token.split('.')[1]
            JSONObject(String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8))
                .getString("sub").takeIf { it.isNotBlank() }
        }.getOrNull() ?: throw IOException("Missing account identity")
        return Owner(snapshot.identity, "account:$subject")
    }

    fun migrate(legacy: String?) = synchronized(sessions) {
        if (prefs.getBoolean("legacy_migrated", false)) return@synchronized
        val owner = runCatching { owner() }.getOrNull()
        val edit = prefs.edit().putBoolean("legacy_migrated", true)
        if (legacy != null) {
            val key = owner?.key ?: "unowned_legacy_retry_data"
            if (!prefs.contains(key)) edit.putString(key, legacy)
        }
        if (!edit.commit()) throw IOException("Retry data could not be secured")
    }

    fun read(owner: Owner, legacy: String?): String? = synchronized(sessions) {
        requireCurrent(owner)
        migrate(legacy)
        prefs.getString(owner.key, null)
    }

    fun write(owner: Owner, value: String?) = synchronized(sessions) {
        requireCurrent(owner)
        val edit = prefs.edit()
        if (value == null) edit.remove(owner.key) else edit.putString(owner.key, value)
        if (!edit.commit()) throw IOException("Retry data could not be saved")
    }

    private fun requireCurrent(owner: Owner) {
        if (!sessions.isCurrent(owner.identity)) throw IOException("Session changed")
    }
}
