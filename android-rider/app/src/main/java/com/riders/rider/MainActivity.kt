package com.riders.rider

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.fragment.app.FragmentActivity
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.riders.rider.core.design.AppearanceViewModel
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.profile.presentation.ProfileViewModel
import com.riders.rider.feature.offers.domain.ACCEPTED_BID_EXTRA_DELIVERY_ID
import com.riders.rider.feature.offers.domain.ACCOUNT_APPROVED_EXTRA
import com.riders.rider.feature.offers.domain.CUSTOMER_CANCELLED_EXTRA_DELIVERY_ID
import com.riders.rider.feature.offers.domain.OFFER_EXTRA_ASSIGNMENT_ID
import com.riders.rider.feature.offers.domain.acceptedBidTapDeliveryId
import com.riders.rider.feature.offers.notification.OfferPushCoordinator
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.navigation.RiderNavHost
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    @Inject lateinit var pendingOffer: PendingOffer
    @Inject lateinit var offerPush: OfferPushCoordinator
    @Inject lateinit var bids: BidRepository
    @Inject lateinit var sessions: SessionStore
    @Inject lateinit var assignments: com.riders.rider.feature.delivery.data.AssignmentRepository

    @Inject lateinit var cleanup: com.riders.rider.core.session.SessionCleanup

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching { captureOffer(intent) }
        enableEdgeToEdge()
        setContent {
            val appearance: AppearanceViewModel = hiltViewModel()
            val appearanceMode by appearance.mode.collectAsStateWithLifecycle()
            RiderTheme(mode = appearanceMode) {
                val session: SessionViewModel = hiltViewModel()
                val ui by session.ui.collectAsStateWithLifecycle()
                val identity by sessions.identity.collectAsStateWithLifecycle()
                var prepared by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(identity) {
                    cleanup.prepare(identity)
                    if (sessions.snapshot().identity == identity) {
                        prepared = identity
                        if (sessions.isCurrent(identity)) offerPush.onHome()
                    }
                }
                if (prepared == identity) key(identity) {
                    // Navigation graph is recreated for a new login, even if a null state was conflated.
                    val profile: ProfileViewModel = hiltViewModel(key = "session-profile:$identity")
                    DisposableEffect(identity) { onDispose { if (!sessions.isCurrent(identity)) profile.clearPrivateState() } }
                    if (sessions.isCurrent(identity) && ui.entry == AppEntry.Home) {
                        RiderNavHost(signedIn = true, sessionUncertain = ui.sessionUncertain, onSignInAgain = profile::logout)
                    } else if (!sessions.isCurrent(identity)) {
                        RiderNavHost(signedIn = false, notice = ui.notice)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        runCatching { captureOffer(intent) }
    }

    private fun validNotificationId(id: String): Boolean = id.length in 1..128 && id.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    private fun captureOffer(intent: Intent?) {
        if (intent == null) return
        // Only immutable notification PendingIntents created for this login carry this capability.
        val owner = intent.getStringExtra(com.riders.rider.feature.offers.notification.NOTIFICATION_SESSION)
        intent.removeExtra(com.riders.rider.feature.offers.notification.NOTIFICATION_SESSION)
        if (owner == null || !sessions.isCurrent(owner)) return
        val requestId = intent?.getStringExtra(OFFER_EXTRA_ASSIGNMENT_ID)?.trim().orEmpty()
        if (validNotificationId(requestId)) {
            pendingOffer.notificationTapped(requestId)
            intent?.removeExtra(OFFER_EXTRA_ASSIGNMENT_ID)
            if (sessions.isCurrent(owner)) {
                lifecycleScope.launch { cleanup.prepare(owner); if (sessions.isCurrent(owner)) bids.openRequests() }
            }
        }
        val deliveryId = acceptedBidTapDeliveryId(
            explicitId = intent?.getStringExtra(ACCEPTED_BID_EXTRA_DELIVERY_ID),
            payloadType = intent?.getStringExtra("type"),
            payloadDeliveryId = intent?.getStringExtra("deliveryId"),
        )
        if (deliveryId != null && validNotificationId(deliveryId)) {
            assignments.invalidateAssignments()
            bids.invalidateOwnBids()
            pendingOffer.acceptedBidTapped(deliveryId)
            intent?.removeExtra(ACCEPTED_BID_EXTRA_DELIVERY_ID)
            if (intent?.getStringExtra("type") == "v2_bid_accepted") {
                intent.removeExtra("type")
                intent.removeExtra("deliveryId")
            }
        }
        val cancelledDeliveryId = intent?.getStringExtra(CUSTOMER_CANCELLED_EXTRA_DELIVERY_ID)?.trim().orEmpty()
        if (validNotificationId(cancelledDeliveryId)) {
            assignments.invalidateAssignments()
            bids.invalidateOwnBids()
            pendingOffer.customerCancelledTapped(cancelledDeliveryId)
            intent?.removeExtra(CUSTOMER_CANCELLED_EXTRA_DELIVERY_ID)
        }
        if (intent?.getBooleanExtra(ACCOUNT_APPROVED_EXTRA, false) == true) {
            pendingOffer.accountApprovedTapped()
            intent.removeExtra(ACCOUNT_APPROVED_EXTRA)
        }
    }
}
