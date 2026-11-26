package com.riders.rider.feature.delivery.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.core.database.DeliverySnapshotEntity
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.delivery.domain.CommittedParcel
import javax.inject.Inject
import javax.inject.Singleton
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

data class OfflineSnapshot(val parcels: List<CommittedParcel>, val savedAt: Long)

@Singleton
class OfflineDeliveryCache @Inject constructor(database: RiderDatabase, private val sessions: SessionStore) {
    private val dao = database.deliverySnapshotDao()
    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("rider_offline_delivery_v2", null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder("rider_offline_delivery_v2", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
    }
    private fun aad(owner: String, kind: String, time: Long) = "$owner:$kind:$time".toByteArray(Charsets.UTF_8)
    suspend fun save(owner: String, kind: String, parcels: List<CommittedParcel>) = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                if (!sessions.isCurrent(owner)) return@withLock
                val time = System.currentTimeMillis()
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key())
                cipher.updateAAD(aad(owner, kind, time))
                val payload = cipher.iv + cipher.doFinal(json.encodeToString(parcels.map { it.copy(contacts = null, parcelInstructions = null, pickupInstructions = null, dropoffInstructions = null) }).toByteArray(Charsets.UTF_8))
                if (sessions.isCurrent(owner)) dao.write(DeliverySnapshotEntity(owner, kind, time, payload))
                if (!sessions.isCurrent(owner)) dao.purgeOthers(sessions.snapshot().identity)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { android.util.Log.w("OfflineDeliveryCache", "Snapshot write failed") }
        }
    }
    suspend fun purgeInactive() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val snapshot = sessions.snapshot()
            if (snapshot.session == null) dao.clear() else dao.purgeOthers(snapshot.identity)
        }
    }
    suspend fun read(kind: String): OfflineSnapshot? = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                val owner = sessions.snapshot().identity
                if (!sessions.isCurrent(owner)) return@withLock null
                val row = dao.read(owner, kind) ?: return@withLock null
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, row.ciphertext.copyOfRange(0, 12)))
                cipher.updateAAD(aad(owner, kind, row.savedAt))
                val parcels = json.decodeFromString<List<CommittedParcel>>(cipher.doFinal(row.ciphertext.copyOfRange(12, row.ciphertext.size)).toString(Charsets.UTF_8))
                if (sessions.isCurrent(owner)) OfflineSnapshot(parcels, row.savedAt) else null
            } catch (e: CancellationException) { throw e } catch (_: Exception) { android.util.Log.w("OfflineDeliveryCache", "Snapshot read failed"); null }
        }
    }
}
