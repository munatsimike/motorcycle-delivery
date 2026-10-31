package com.riders.rider.feature.offers.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.riders.rider.feature.offers.domain.RiderNotice
import com.riders.rider.feature.offers.domain.parseRiderNotice
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class RiderOfferMessagingService : FirebaseMessagingService() {
    @Inject lateinit var coordinator: OfferPushCoordinator
    @Inject lateinit var poster: OfferNotificationPoster
    @Inject lateinit var pending: PendingOffer
    @Inject lateinit var shown: ShownOfferStore

    override fun onMessageReceived(message: RemoteMessage) {
        when (val notice = parseRiderNotice(message.data)) {
            is RiderNotice.Offer -> return
            is RiderNotice.BidAccepted -> {
                if (!shown.markIfNew("accepted:${notice.deliveryId}")) {
                    return
                }
                pending.acceptedBidArrived(notice.deliveryId)
                poster.showAccepted(notice.deliveryId)
            }
            null -> return
        }
    }

    override fun onNewToken(token: String) {
        coordinator.onNewToken(token)
    }
}
