package com.riders.rider.feature.offers.notification

import android.content.Context
import com.riders.rider.feature.offers.domain.rememberShownOffer
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

@Singleton
class PendingOffer @Inject constructor() {
    private val tap = MutableStateFlow<String?>(null)
    private val arrivals = MutableSharedFlow<String>(extraBufferCapacity = 8)
    private val acceptedTap = MutableStateFlow<String?>(null)
    private val acceptedArrivalsFlow = MutableSharedFlow<String>(extraBufferCapacity = 8)

    val taps: StateFlow<String?> = tap.asStateFlow()
    val arrived: SharedFlow<String> = arrivals.asSharedFlow()
    val acceptedTaps: StateFlow<String?> = acceptedTap.asStateFlow()
    val acceptedArrivals: SharedFlow<String> = acceptedArrivalsFlow.asSharedFlow()

    fun offerArrived(assignmentId: String) {
        arrivals.tryEmit(assignmentId)
    }

    fun notificationTapped(assignmentId: String) {
        tap.value = assignmentId
    }

    fun clear() {
        tap.value = null
    }

    fun acceptedBidArrived(deliveryId: String) {
        acceptedArrivalsFlow.tryEmit(deliveryId)
    }

    fun acceptedBidTapped(deliveryId: String) {
        acceptedTap.value = deliveryId.trim()
    }

    fun clearAccepted() {
        acceptedTap.value = null
    }
}

@Singleton
class ShownOfferStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun markIfNew(assignmentId: String): Boolean {
        val existing = preferences.getString(SHOWN, null).orEmpty().split('\n').filter { it.isNotBlank() }
        val updated = rememberShownOffer(existing, assignmentId) ?: return false
        preferences.edit().putString(SHOWN, updated.joinToString("\n")).apply()
        return true
    }

    fun clear() {
        preferences.edit().remove(SHOWN).apply()
    }

    companion object {
        const val PREFS = "rider_offer_notifications"
        const val SHOWN = "shown_assignment_ids"
        const val TOKEN = "fcm_token"
        const val PERMISSION_ASKED = "permission_asked"
    }
}
