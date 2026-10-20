package com.riders.rider

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.presentation.BiometricOfferScreen
import com.riders.rider.feature.auth.presentation.BiometricUnlockScreen
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.navigation.RiderNavHost
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RiderTheme {
                val session: SessionViewModel = hiltViewModel()
                val ui by session.ui.collectAsStateWithLifecycle()
                when (ui.entry) {
                    AppEntry.Home -> RiderNavHost(signedIn = true)
                    AppEntry.Unlock -> BiometricUnlockScreen(session)
                    AppEntry.Offer -> BiometricOfferScreen(session)
                    AppEntry.SignedOut -> RiderNavHost(signedIn = false)
                }
            }
        }
    }
}
