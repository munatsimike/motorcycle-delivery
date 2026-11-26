package com.riders.rider.feature.bids.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.feature.bids.domain.BidAttempt
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidAttemptAfterRefresh
import com.riders.rider.feature.bids.domain.nextBidAttempt
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private val Context.bidAttemptStore by preferencesDataStore(name = "rider_bid_attempts")

private val AttemptJson = Json { ignoreUnknownKeys = true }

@Serializable
private data class AttemptFile(
    val attempts: Map<String, BidAttempt> = emptyMap(),
)

@Singleton
class BidAttemptStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    sessions: com.riders.rider.core.session.SessionStore,
) {
    private val mutex = Mutex()
    private val storage = com.riders.rider.core.session.PrivateRetryFile(context, "rider_bid_attempts_private", sessions)
    private val fileKey = stringPreferencesKey("attempts")
    private val newKey = { UUID.randomUUID().toString() }

    suspend fun attempt(deliveryId: String, amountCents: Int): BidAttempt = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        val next = nextBidAttempt(file.attempts[deliveryId], deliveryId, amountCents, newKey())
        if (file.attempts[deliveryId] != next) {
            write(owner, file.copy(attempts = file.attempts + (deliveryId to next)))
        }
        next
    }

    suspend fun pending(deliveryId: String): BidAttempt? = mutex.withLock {
        read(storage.owner()).attempts[deliveryId]
    }

    suspend fun clear(deliveryId: String) = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        if (file.attempts.containsKey(deliveryId)) {
            write(owner, file.copy(attempts = file.attempts - deliveryId))
        }
    }

    suspend fun retain(bids: List<OwnBid>) = mutex.withLock {
        val owner = storage.owner()
        val file = read(owner)
        val remaining = file.attempts.filterValues { attempt -> bidAttemptAfterRefresh(attempt, bids) != null }
        if (remaining.size != file.attempts.size) {
            write(owner, file.copy(attempts = remaining))
        }
    }

    suspend fun migrateLegacy() = mutex.withLock {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val legacy = context.bidAttemptStore.data.first()[fileKey]
            storage.migrate(legacy)
            if (legacy != null) context.bidAttemptStore.edit { it.remove(fileKey) }
        }
        Unit
    }

    private suspend fun read(owner: com.riders.rider.core.session.PrivateRetryFile.Owner): AttemptFile = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val legacy = context.bidAttemptStore.data.first()[fileKey]
        val raw = storage.read(owner, legacy)
        if (legacy != null) context.bidAttemptStore.edit { it.remove(fileKey) }
        if (raw.isNullOrBlank()) AttemptFile() else AttemptJson.decodeFromString(AttemptFile.serializer(), raw)
    }

    private suspend fun write(owner: com.riders.rider.core.session.PrivateRetryFile.Owner, file: AttemptFile) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        storage.write(owner, AttemptJson.encodeToString(AttemptFile.serializer(), file))
    }

}
