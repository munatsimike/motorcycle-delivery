package com.riders.rider.feature.delivery.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.feature.delivery.domain.CancellationAttempt
import com.riders.rider.feature.delivery.domain.TransitionAttempt
import com.riders.rider.feature.delivery.domain.cancellationAttempt
import com.riders.rider.feature.delivery.domain.progressAttempt
import com.riders.rider.feature.delivery.domain.progressAttemptAfterRefresh
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private val Context.transitionKeyStore by preferencesDataStore(name = "rider_transition_keys")

private val TransitionJson = Json { ignoreUnknownKeys = true }

@Serializable
private data class TransitionFile(
    val progress: Map<String, TransitionAttempt> = emptyMap(),
    val cancellation: Map<String, CancellationAttempt> = emptyMap(),
)

@Singleton
class TransitionKeyStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    sessions: com.riders.rider.core.session.SessionStore,
) {
    private val mutex = Mutex()
    private val storage = com.riders.rider.core.session.PrivateRetryFile(context, "rider_transition_keys_private", sessions)
    private val newKey = { UUID.randomUUID().toString() }

    suspend fun progressKey(deliveryId: String, targetStatus: String): TransitionAttempt = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        val next = progressAttempt(file.progress[deliveryId], deliveryId, targetStatus, newKey())
        if (file.progress[deliveryId] != next) {
            write(owner, file.copy(progress = file.progress + (deliveryId to next)))
        }
        next
    }

    suspend fun pendingProgress(deliveryId: String): TransitionAttempt? = mutex.withLock {
        read(storage.owner()).progress[deliveryId]
    }

    suspend fun clearProgressIfCommitted(deliveryId: String, serverStatus: String?): TransitionAttempt? = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        val remaining = progressAttemptAfterRefresh(file.progress[deliveryId], serverStatus)
        if (remaining == null && file.progress.containsKey(deliveryId)) {
            write(owner, file.copy(progress = file.progress - deliveryId))
        }
        remaining
    }

    suspend fun clearProgress(deliveryId: String) = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        if (file.progress.containsKey(deliveryId)) {
            write(owner, file.copy(progress = file.progress - deliveryId))
        }
    }

    suspend fun cancellationKey(assignmentId: String, reason: String, note: String?): CancellationAttempt = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        val next = cancellationAttempt(file.cancellation[assignmentId], assignmentId, reason, note, newKey())
        if (file.cancellation[assignmentId] != next) {
            write(owner, file.copy(cancellation = file.cancellation + (assignmentId to next)))
        }
        next
    }

    suspend fun pendingCancellation(assignmentId: String): CancellationAttempt? = mutex.withLock {
        read(storage.owner()).cancellation[assignmentId]
    }

    suspend fun clearCancellation(assignmentId: String) = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        if (file.cancellation.containsKey(assignmentId)) {
            write(owner, file.copy(cancellation = file.cancellation - assignmentId))
        }
    }

    suspend fun migrateLegacy() = mutex.withLock {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val legacy = context.transitionKeyStore.data.first()[FileKey]
            storage.migrate(legacy)
            if (legacy != null) context.transitionKeyStore.edit { it.remove(FileKey) }
        }
        Unit
    }

    private suspend fun read(owner: com.riders.rider.core.session.PrivateRetryFile.Owner): TransitionFile = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val legacy = context.transitionKeyStore.data.first()[FileKey]
        val raw = storage.read(owner, legacy)
        if (legacy != null) context.transitionKeyStore.edit { it.remove(FileKey) }
        if (raw.isNullOrBlank()) TransitionFile() else TransitionJson.decodeFromString(TransitionFile.serializer(), raw)
    }

    private suspend fun write(owner: com.riders.rider.core.session.PrivateRetryFile.Owner, file: TransitionFile) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        storage.write(owner, TransitionJson.encodeToString(TransitionFile.serializer(), file))
    }

    private companion object {
        val FileKey = stringPreferencesKey("transitions")
    }
}
