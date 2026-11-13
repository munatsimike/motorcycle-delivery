package com.riders.rider.feature.offers.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.riders.rider.feature.offers.domain.RiderNoticeAction
import com.riders.rider.feature.offers.domain.parseRiderNotice
import com.riders.rider.feature.offers.domain.riderNoticeAction
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class RiderOfferMessagingService : FirebaseMessagingService() {
    @Inject lateinit var coordinator: OfferPushCoordinator
    @Inject lateinit var poster: OfferNotificationPoster
    @Inject lateinit var pending: PendingOffer
    @Inject lateinit var shown: ShownOfferStore

    override fun onMessageReceived(message: RemoteMessage) {
        when (val action = riderNoticeAction(parseRiderNotice(message.data))) {
            is RiderNoticeAction.ShowOffer -> {
                if (!shown.markIfNew("offer:${action.deliveryId}:${action.expiresAt}")) {
                    return
                }
                pending.offerArrived(action.deliveryId)
                poster.show(action.deliveryId)
            }
            is RiderNoticeAction.ShowAccepted -> {
                if (!shown.markIfNew("accepted:${action.deliveryId}")) {
                    return
                }
                pending.acceptedBidArrived(action.deliveryId)
                poster.showAccepted(action.deliveryId)
            }
            is RiderNoticeAction.ShowApproved -> {
                if (!shown.markIfNew("approved:${action.approvedAt}")) {
                    return
                }
                poster.showApproved()
            }
            RiderNoticeAction.Ignore -> return
        }
    }

    override fun onNewToken(token: String) {
        coordinator.onNewToken(token)
    }
}
