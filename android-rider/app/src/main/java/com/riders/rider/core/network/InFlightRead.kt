package com.riders.rider.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Share an overlapping read for the same session, not a completed response. */
internal class InFlightRead<K, T>(private val maxJoinAgeNanos: Long = 1_000_000_000L) {
    private val lock = Any()
    private data class Flight<K, T>(val key: K, val request: Deferred<T>, val startedAt: Long)
    private var flight: Flight<K, T>? = null

    suspend fun read(key: K, load: suspend () -> T): T = coroutineScope {
        while (true) {
            val (request, owner) = synchronized(lock) {
                val existing = flight
                if (existing != null && existing.key == key && existing.request.isActive &&
                    (System.nanoTime() - existing.startedAt) in 0L..maxJoinAgeNanos) {
                    existing.request to false
                } else {
                    val created = async(start = CoroutineStart.LAZY) { load() }
                    flight = Flight(key, created, System.nanoTime())
                    created.start()
                    created to true
                }
            }
            try {
                return@coroutineScope request.await()
            } catch (cancelled: CancellationException) {
                currentCoroutineContext().ensureActive()
                if (owner) throw cancelled
                // The owner screen was closed. A still-active waiter can retry.
            } finally {
                synchronized(lock) {
                    if (flight?.request === request && request.isCompleted) flight = null
                }
            }
        }
        @Suppress("UNREACHABLE_CODE")
        error("Unreachable")
    }
}
