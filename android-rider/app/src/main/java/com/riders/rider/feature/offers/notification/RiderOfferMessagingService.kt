package com.riders.rider.feature.offers.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.riders.rider.feature.offers.domain.RiderNoticeAction
import com.riders.rider.feature.offers.domain.offerAttemptKey
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.riderNoticeAction
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
            when (val action = riderNoticeAction(parseRiderNotice(message.data))) {
                is RiderNoticeAction.ShowOffer -> {
                    if (!shown.markIfNew(offerAttemptKey(action.deliveryId, action.expiresAt))) {
                        return
                    }
                    bids.invalidateOwnBids()
                    pending.offerArrived(action.deliveryId)
                    poster.show(action.deliveryId)
                }
                is RiderNoticeAction.ShowAccepted -> {
                    if (!shown.markIfNew("accepted:${action.deliveryId}")) {
                        return
                    }
                    bids.invalidateOwnBids()
                    assignments.invalidateAssignments()
                    pending.acceptedBidArrived(action.deliveryId)
                    poster.showAccepted(action.deliveryId)
                }
                is RiderNoticeAction.ShowBidExpired -> {
                    bids.invalidateOwnBids()
                    pending.bidExpiredArrived(action.deliveryId)
                    poster.showBidExpired(action.deliveryId)
                }
                is RiderNoticeAction.ShowCustomerCancelled -> {
                    if (!shown.markIfNew("cancelled:${action.deliveryId}")) {
                        return
                    }
                    bids.invalidateOwnBids()
                    assignments.invalidateAssignments()
                    pending.customerCancelledArrived(action.deliveryId)
                    poster.showCustomerCancelled(action.deliveryId)
                }
                is RiderNoticeAction.ShowApproved -> {
                    if (!shown.markIfNew("approved:${action.approvedAt}")) {
                        return
                    }
                    poster.showApproved()
                }
                RiderNoticeAction.Ignore -> return@synchronized
            }
        }
    }

    override fun onNewToken(token: String) {
        coordinator.onNewToken(token)
    }
}
