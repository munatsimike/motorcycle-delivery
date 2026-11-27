package com.riders.rider.feature.offers.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.riders.rider.feature.offers.domain.RiderNoticeAction
import com.riders.rider.feature.offers.domain.offerAttemptKey
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.riderNoticeAction
import com.riders.rider.feature.offers.domain.requiresOwnBidInvalidation
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class RiderOfferMessagingService : FirebaseMessagingService() {
    @Inject lateinit var sessions: com.riders.rider.core.session.SessionStore
    @Inject lateinit var coordinator: OfferPushCoordinator
    @Inject lateinit var poster: OfferNotificationPoster
    @Inject lateinit var pending: PendingOffer
    @Inject lateinit var shown: ShownOfferStore
    @Inject lateinit var bids: com.riders.rider.feature.bids.data.BidRepository
    @Inject lateinit var assignments: com.riders.rider.feature.delivery.data.AssignmentRepository

    override fun onMessageReceived(message: RemoteMessage) {
        synchronized(sessions) {
            if (!coordinator.canReceive(sessions.snapshot().identity)) return@synchronized
            val action = riderNoticeAction(parseRiderNotice(message.data))
            val fresh = when (action) {
                is RiderNoticeAction.ShowOffer -> shown.markIfNew(offerAttemptKey(action.deliveryId, action.expiresAt))
                is RiderNoticeAction.ShowAccepted -> shown.markIfNew("accepted:${action.deliveryId}")
                is RiderNoticeAction.ShowCustomerCancelled -> shown.markIfNew("cancelled:${action.deliveryId}")
                is RiderNoticeAction.ShowBidExpired, is RiderNoticeAction.ShowApproved -> true
                RiderNoticeAction.Ignore -> false
            }
            if (!fresh) return@synchronized
            // A new opportunity only schedules the existing background board refresh.
            // Do not temporarily revoke known bid status for the request already open.
            if (action.requiresOwnBidInvalidation()) bids.invalidateOwnBids()
            when (action) {
                is RiderNoticeAction.ShowOffer -> {
                    pending.offerArrived(action.deliveryId)
                    poster.show(action.deliveryId)
                }
                is RiderNoticeAction.ShowAccepted -> {
                    assignments.invalidateAssignments()
                    pending.acceptedBidArrived(action.deliveryId)
                    poster.showAccepted(action.deliveryId)
                }
                is RiderNoticeAction.ShowBidExpired -> {
                    pending.bidExpiredArrived(action.deliveryId)
                    poster.showBidExpired(action.deliveryId)
                }
                is RiderNoticeAction.ShowCustomerCancelled -> {
                    assignments.invalidateAssignments()
                    pending.customerCancelledArrived(action.deliveryId)
                    poster.showCustomerCancelled(action.deliveryId)
                }
                is RiderNoticeAction.ShowApproved -> poster.showApproved()
                RiderNoticeAction.Ignore -> Unit
            }
        }
    }

    override fun onNewToken(token: String) {
        coordinator.onNewToken(token)
    }
}
