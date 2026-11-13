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
) {
    private val mutex = Mutex()
    private val fileKey = stringPreferencesKey("attempts")
    private val newKey = { UUID.randomUUID().toString() }

    suspend fun attempt(deliveryId: String, amountCents: Int): BidAttempt = mutex.withLock {
        val file = read()
        val next = nextBidAttempt(file.attempts[deliveryId], deliveryId, amountCents, newKey())
        if (file.attempts[deliveryId] != next) {
            write(file.copy(attempts = file.attempts + (deliveryId to next)))
        }
        next
    }

    suspend fun pending(deliveryId: String): BidAttempt? = mutex.withLock {
        read().attempts[deliveryId]
    }

    suspend fun clear(deliveryId: String) = mutex.withLock {
        val file = read()
        if (file.attempts.containsKey(deliveryId)) {
            write(file.copy(attempts = file.attempts - deliveryId))
        }
    }

    suspend fun retain(bids: List<OwnBid>) = mutex.withLock {
        val file = read()
        val remaining = file.attempts.filterValues { attempt -> bidAttemptAfterRefresh(attempt, bids) != null }
        if (remaining.size != file.attempts.size) {
            write(file.copy(attempts = remaining))
        }
    }

    private suspend fun read(): AttemptFile {
        val raw = context.bidAttemptStore.data.first()[fileKey] ?: return AttemptFile()
        return try {
            AttemptJson.decodeFromString<AttemptFile>(raw)
        } catch (_: Exception) {
            AttemptFile()
        }
    }

    private suspend fun write(file: AttemptFile) {
        context.bidAttemptStore.edit { preferences ->
            preferences[fileKey] = AttemptJson.encodeToString(file)
        }
    }
}
