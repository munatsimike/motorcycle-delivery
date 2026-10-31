package com.riders.rider

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.feature.offers.domain.ACCEPTED_BID_EXTRA_DELIVERY_ID
import com.riders.rider.feature.offers.notification.OfferPushCoordinator
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.navigation.RiderNavHost
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    @Inject lateinit var pendingOffer: PendingOffer
    @Inject lateinit var offerPush: OfferPushCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        captureOffer(intent)
        enableEdgeToEdge()
        setContent {
            RiderTheme {
                val session: SessionViewModel = hiltViewModel()
                val ui by session.ui.collectAsStateWithLifecycle()
                LaunchedEffect(ui.entry) {
                    if (ui.entry == AppEntry.Home) {
                        offerPush.onHome()
                    }
                }
                when (ui.entry) {
                    AppEntry.Home -> RiderNavHost(signedIn = true)
                    AppEntry.SignedOut -> RiderNavHost(signedIn = false, notice = ui.notice)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureOffer(intent)
    }

    private fun captureOffer(intent: Intent?) {
        val deliveryId = intent?.getStringExtra(ACCEPTED_BID_EXTRA_DELIVERY_ID)?.trim().orEmpty()
        if (deliveryId.isNotEmpty()) {
            pendingOffer.acceptedBidTapped(deliveryId)
            intent?.removeExtra(ACCEPTED_BID_EXTRA_DELIVERY_ID)
        }
    }
}
