package com.riders.rider.core.session

import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.offers.notification.OfferPushCoordinator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionCleanup @Inject constructor(
    private val sessions: SessionStore,
    private val database: RiderDatabase,
    private val deliveries: ActiveDeliveryStore,
    private val assignments: AssignmentRepository,
    private val offline: com.riders.rider.feature.delivery.data.OfflineDeliveryCache,
    private val bids: BidRepository,
    private val verification: VerificationRepository,
    private val push: OfferPushCoordinator,
    private val bidAttempts: com.riders.rider.feature.bids.data.BidAttemptStore,
    private val transitionKeys: com.riders.rider.feature.delivery.data.TransitionKeyStore,
    private val acceptKeys: com.riders.rider.feature.offers.data.DataStoreAcceptKeyStore,
    private val freshness: com.riders.rider.feature.availability.domain.LocationFreshness,
    private val locations: com.riders.rider.feature.availability.RiderLocationHub,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
) {
    private val lock = Mutex()
    private var prepared: String? = null

    suspend fun prepare(identity: String) = lock.withLock {
        if (prepared == identity || sessions.snapshot().identity != identity) return@withLock
        val changed = prepared != null
        if (!changed) {
            runCatching { bidAttempts.migrateLegacy() }
            runCatching { transitionKeys.migrateLegacy() }
            runCatching { acceptKeys.migrateLegacy() }
        }
        assignments.clearSession()
        bids.clearSession()
        verification.invalidateDocuments()
        if (changed || sessions.read() == null) {
            push.resetRegistration(clearNotifications = true)
            freshness.invalidate()
            locations.clear()
            context.stopService(android.content.Intent(context, com.riders.rider.feature.availability.RiderLocationService::class.java))
        }
        withContext(Dispatchers.IO) {
            // Remove legacy plaintext rows; delivery snapshots are encrypted.
            runCatching {
                database.openHelper.writableDatabase.execSQL("DELETE FROM onboarding_cache")
                database.offerDao().clear()

            }
            runCatching { deliveries.purgeLegacyAndOtherSessions() }
        }
        try { offline.purgeInactive() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) {
            android.util.Log.w("SessionCleanup", "Snapshot cleanup failed")
            return@withLock
        }
        prepared = identity
    }
}
