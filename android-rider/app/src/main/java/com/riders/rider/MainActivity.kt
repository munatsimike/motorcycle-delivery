package com.riders.rider

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.navigation.RiderNavHost
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RiderTheme {
                val session: SessionViewModel = hiltViewModel()
                val signedIn by session.signedIn.collectAsStateWithLifecycle()
                RiderNavHost(signedIn = signedIn)
            }
        }
    }
}
