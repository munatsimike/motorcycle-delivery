package com.riders.rider.feature.delivery.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.core.session.SessionStore
import com.riders.rider.core.session.privateCache
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

private val Context.deliveryStore by preferencesDataStore(name = "rider_delivery")
private val DeliveryJson = Json { ignoreUnknownKeys = true }

@Singleton
class ActiveDeliveryStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val sessions: SessionStore,
) {
    private val secure by lazy { privateCache(context, "rider_delivery_private") }

    suspend fun read(): ActiveDelivery? = withContext(Dispatchers.IO) {
        synchronized(sessions) {
            val session = sessions.snapshot()
            if (session.session == null) return@synchronized null
            runCatching {
                if (secure.getString("owner", null) != session.identity) null
                else secure.getString("snapshot", null)?.let { DeliveryJson.decodeFromString(ActiveDelivery.serializer(), it) }
            }.getOrNull()
        }
    }

    suspend fun write(delivery: ActiveDelivery, identity: String = sessions.snapshot().identity) = withContext(Dispatchers.IO) {
        synchronized(sessions) {
            if (!sessions.isCurrent(identity)) throw java.io.IOException("Session changed")
            if (!secure.edit().putString("owner", identity)
                    .putString("snapshot", DeliveryJson.encodeToString(ActiveDelivery.serializer(), delivery)).commit()) {
                throw java.io.IOException("Delivery could not be saved")
            }
        }
        Unit
    }

    suspend fun clear(identity: String = sessions.snapshot().identity) = withContext(Dispatchers.IO) {
        synchronized(sessions) {
            if (sessions.snapshot().identity == identity) runCatching { secure.edit().clear().commit() }
        }
        Unit
    }

    /** Legacy snapshots have no owner; never import them into another account. */
    suspend fun purgeLegacyAndOtherSessions() = withContext(Dispatchers.IO) {
        context.deliveryStore.edit { it.clear() }
        synchronized(sessions) {
            val snapshot = sessions.snapshot()
            runCatching {
                if (snapshot.session == null || secure.getString("owner", null) != snapshot.identity) {
                    secure.edit().clear().commit()
                }
            }
        }
        Unit
    }
}
