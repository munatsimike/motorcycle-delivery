package com.riders.rider.feature.delivery.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json

private val Context.deliveryStore by preferencesDataStore(name = "rider_delivery")

private val DeliveryJson = Json { ignoreUnknownKeys = true }

@Singleton
class ActiveDeliveryStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    suspend fun read(): ActiveDelivery? {
        val prefs = context.deliveryStore.data.first()
        val snapshot = prefs[Snapshot]
        if (!snapshot.isNullOrBlank()) {
            return decode(snapshot)
        }
        val deliveryId = prefs[DeliveryId] ?: return null
        val assignmentId = prefs[AssignmentId] ?: return null
        val status = prefs[Status] ?: return null
        return ActiveDelivery(deliveryId, assignmentId, status)
    }

    suspend fun write(delivery: ActiveDelivery) {
        context.deliveryStore.edit { prefs ->
            prefs[Snapshot] = DeliveryJson.encodeToString(ActiveDelivery.serializer(), delivery)
            prefs[DeliveryId] = delivery.deliveryId
            prefs[AssignmentId] = delivery.assignmentId
            prefs[Status] = delivery.status
        }
    }

    suspend fun updateStatus(deliveryId: String, status: String): ActiveDelivery? {
        val current = read() ?: return null
        if (current.deliveryId != deliveryId) {
            return null
        }
        val updated = current.copy(status = status)
        write(updated)
        return updated
    }

    suspend fun clear() {
        context.deliveryStore.edit { it.clear() }
    }

    private fun decode(raw: String): ActiveDelivery? {
        return try {
            DeliveryJson.decodeFromString(ActiveDelivery.serializer(), raw)
        } catch (_: Exception) {
            null
        }
    }

    private companion object {
        val Snapshot = stringPreferencesKey("snapshot")
        val DeliveryId = stringPreferencesKey("delivery_id")
        val AssignmentId = stringPreferencesKey("assignment_id")
        val Status = stringPreferencesKey("status")
    }
}
