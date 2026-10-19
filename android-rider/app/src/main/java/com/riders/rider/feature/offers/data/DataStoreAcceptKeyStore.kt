package com.riders.rider.feature.offers.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.feature.offers.domain.AcceptKeyStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private val Context.acceptKeyStore by preferencesDataStore(name = "rider_accept_keys")

private val KeysJson = Json { ignoreUnknownKeys = true }

@Serializable
private data class AcceptKeyFile(val keys: Map<String, String> = emptyMap())

@Singleton
class DataStoreAcceptKeyStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : AcceptKeyStore {
    override suspend fun read(assignmentId: String): String? = file().keys[assignmentId]

    override suspend fun save(assignmentId: String, key: String) {
        context.acceptKeyStore.edit { prefs ->
            val current = decode(prefs[Keys])
            if (current.keys[assignmentId] != null) {
                return@edit
            }
            prefs[Keys] = encode(current.copy(keys = current.keys + (assignmentId to key)))
        }
    }

    override suspend fun clear(assignmentId: String) {
        context.acceptKeyStore.edit { prefs ->
            val current = decode(prefs[Keys])
            prefs[Keys] = encode(current.copy(keys = current.keys - assignmentId))
        }
    }

    override suspend fun clearAll() {
        context.acceptKeyStore.edit { it.clear() }
    }

    private suspend fun file(): AcceptKeyFile = decode(context.acceptKeyStore.data.first()[Keys])

    private fun decode(raw: String?): AcceptKeyFile {
        if (raw.isNullOrBlank()) {
            return AcceptKeyFile()
        }
        return try {
            KeysJson.decodeFromString(AcceptKeyFile.serializer(), raw)
        } catch (_: Exception) {
            AcceptKeyFile()
        }
    }

    private fun encode(file: AcceptKeyFile): String = KeysJson.encodeToString(AcceptKeyFile.serializer(), file)

    private companion object {
        val Keys = stringPreferencesKey("keys")
    }
}
