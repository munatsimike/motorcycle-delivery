package com.riders.rider.feature.offers.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.core.session.PrivateRetryFile
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.offers.domain.AcceptKeyStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private val Context.acceptKeyStore by preferencesDataStore(name = "rider_accept_keys")
private val KeysJson = Json { ignoreUnknownKeys = true }
@Serializable private data class AcceptKeyFile(val keys: Map<String, String> = emptyMap())

@Singleton
class DataStoreAcceptKeyStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    sessions: SessionStore,
) : AcceptKeyStore {
    private val storage = PrivateRetryFile(context, "rider_accept_keys_private", sessions)
    private val mutex = Mutex()
    override suspend fun read(assignmentId: String): String? = mutex.withLock {
        file(storage.owner()).keys[assignmentId]
    }
    override suspend fun save(assignmentId: String, key: String) = mutex.withLock {
        val owner = storage.owner()
        val current = file(owner)
        if (current.keys[assignmentId] == null) write(owner, current.copy(keys = current.keys + (assignmentId to key)))
    }
    override suspend fun clear(assignmentId: String) = mutex.withLock {
        val owner = storage.owner()
        val current = file(owner)
        write(owner, current.copy(keys = current.keys - assignmentId))
    }
    override suspend fun clearAll() = mutex.withLock {
        val owner = storage.owner()
        file(owner)
        write(owner, AcceptKeyFile())
    }
    suspend fun migrateLegacy() = mutex.withLock {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val legacy = context.acceptKeyStore.data.first()[Keys]
            storage.migrate(legacy)
            if (legacy != null) context.acceptKeyStore.edit { it.remove(Keys) }
        }
        Unit
    }

    private suspend fun file(owner: PrivateRetryFile.Owner): AcceptKeyFile = withContext(Dispatchers.IO) {
        val legacy = context.acceptKeyStore.data.first()[Keys]
        val raw = storage.read(owner, legacy)
        if (legacy != null) context.acceptKeyStore.edit { it.remove(Keys) }
        if (raw.isNullOrBlank()) AcceptKeyFile() else KeysJson.decodeFromString(AcceptKeyFile.serializer(), raw)
    }
    private suspend fun write(owner: PrivateRetryFile.Owner, file: AcceptKeyFile) = withContext(Dispatchers.IO) {
        storage.write(owner, KeysJson.encodeToString(AcceptKeyFile.serializer(), file))
    }
    private companion object { val Keys = stringPreferencesKey("keys") }
}
