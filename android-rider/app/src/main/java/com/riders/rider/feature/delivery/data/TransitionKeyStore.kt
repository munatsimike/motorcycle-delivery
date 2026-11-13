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
) {
    private val mutex = Mutex()
    private val newKey = { UUID.randomUUID().toString() }

    suspend fun progressKey(deliveryId: String, targetStatus: String): TransitionAttempt = mutex.withLock {
        val file = read()
        val next = progressAttempt(file.progress[deliveryId], deliveryId, targetStatus, newKey())
        if (file.progress[deliveryId] != next) {
            write(file.copy(progress = file.progress + (deliveryId to next)))
        }
        next
    }

    suspend fun pendingProgress(deliveryId: String): TransitionAttempt? = mutex.withLock {
        read().progress[deliveryId]
    }

    suspend fun clearProgressIfCommitted(deliveryId: String, serverStatus: String?): TransitionAttempt? = mutex.withLock {
        val file = read()
        val remaining = progressAttemptAfterRefresh(file.progress[deliveryId], serverStatus)
        if (remaining == null && file.progress.containsKey(deliveryId)) {
            write(file.copy(progress = file.progress - deliveryId))
        }
        remaining
    }

    suspend fun clearProgress(deliveryId: String) = mutex.withLock {
        val file = read()
        if (file.progress.containsKey(deliveryId)) {
            write(file.copy(progress = file.progress - deliveryId))
        }
    }

    suspend fun cancellationKey(assignmentId: String, reason: String, note: String?): CancellationAttempt = mutex.withLock {
        val file = read()
        val next = cancellationAttempt(file.cancellation[assignmentId], assignmentId, reason, note, newKey())
        if (file.cancellation[assignmentId] != next) {
            write(file.copy(cancellation = file.cancellation + (assignmentId to next)))
        }
        next
    }

    suspend fun pendingCancellation(assignmentId: String): CancellationAttempt? = mutex.withLock {
        read().cancellation[assignmentId]
    }

    suspend fun clearCancellation(assignmentId: String) = mutex.withLock {
        val file = read()
        if (file.cancellation.containsKey(assignmentId)) {
            write(file.copy(cancellation = file.cancellation - assignmentId))
        }
    }

    private suspend fun read(): TransitionFile {
        val raw = context.transitionKeyStore.data.first()[FileKey]
        if (raw.isNullOrBlank()) {
            return TransitionFile()
        }
        return try {
            TransitionJson.decodeFromString(TransitionFile.serializer(), raw)
        } catch (_: Exception) {
            TransitionFile()
        }
    }

    private suspend fun write(file: TransitionFile) {
        context.transitionKeyStore.edit { prefs ->
            prefs[FileKey] = TransitionJson.encodeToString(TransitionFile.serializer(), file)
        }
    }

    private companion object {
        val FileKey = stringPreferencesKey("transitions")
    }
}
