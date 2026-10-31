package com.riders.rider.feature.offers.domain

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class AcceptedDelivery(
    val assignmentId: String,
    val deliveryId: String,
    val status: String,
    val availability: String,
)

interface AcceptKeyStore {
    suspend fun read(assignmentId: String): String?
    suspend fun save(assignmentId: String, key: String)
    suspend fun clear(assignmentId: String)
    suspend fun clearAll()
}

class MemoryAcceptKeyStore : AcceptKeyStore {
    private val keys = mutableMapOf<String, String>()

    override suspend fun read(assignmentId: String): String? = keys[assignmentId]

    override suspend fun save(assignmentId: String, key: String) {
        if (keys[assignmentId] == null) {
            keys[assignmentId] = key
        }
    }

    override suspend fun clear(assignmentId: String) {
        keys.remove(assignmentId)
    }

    override suspend fun clearAll() {
        keys.clear()
    }
}

class AcceptKeys(
    private val store: AcceptKeyStore = MemoryAcceptKeyStore(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private val mutex = Mutex()

    suspend fun keyFor(assignmentId: String): String = mutex.withLock {
        store.read(assignmentId) ?: newKey().also { store.save(assignmentId, it) }
    }

    suspend fun resolve(assignmentId: String) {
        mutex.withLock { store.clear(assignmentId) }
    }
}

/**
 * One accept call at a time for an assignment. The idempotency key is saved before the request.
 * A timeout or a lost response keeps that key so the next attempt can replay it.
 */
class OfferAcceptance(
    private val keys: AcceptKeys,
    private val send: suspend (assignmentId: String, key: String) -> ApiResult<AcceptedDelivery>,
) {
    private val mutex = Mutex()
    private val inFlight = mutableSetOf<String>()

    suspend fun accept(assignmentId: String): ApiResult<AcceptedDelivery>? {
        if (!mutex.withLock { inFlight.add(assignmentId) }) {
            return null
        }
        try {
            val key = keys.keyFor(assignmentId)
            val result = send(assignmentId, key)
            val resolved = when (result) {
                is ApiResult.Ok -> true
                is ApiResult.Err -> !result.error.leavesAcceptUnresolved()
            }
            if (resolved) {
                keys.resolve(assignmentId)
            }
            return result
        } finally {
            mutex.withLock { inFlight.remove(assignmentId) }
        }
    }
}

fun ApiError.leavesAcceptUnresolved(): Boolean = when (this) {
    ApiError.Network,
    ApiError.Timeout,
    ApiError.Unavailable,
    -> true
    is ApiError.Unexpected -> true
    ApiError.SessionEnded,
    ApiError.SignedInElsewhere,
    ApiError.Forbidden,
    is ApiError.TooManyRequests,
    is ApiError.Validation,
    is ApiError.Conflict,
    -> false
}

val ReleaseReasons = listOf(
    "RIDER_CANCELLED" to "I cannot take this delivery",
    "VEHICLE_PROBLEM" to "Vehicle problem",
)
