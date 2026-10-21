package com.riders.rider.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.NavBackStackEntry
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.home.DeliveriesScreen
import com.riders.rider.feature.home.HomeScreen
import com.riders.rider.feature.home.HomeViewModel
import com.riders.rider.feature.profile.presentation.ProfileScreen
import com.riders.rider.feature.profile.presentation.ProfileViewModel
import com.riders.rider.feature.wallet.presentation.WalletScreen

@Composable
fun RiderShell(
    entry: NavBackStackEntry,
    onDelivery: (String) -> Unit,
    onAccepted: (String) -> Unit,
    onSetup: () -> Unit,
    onLicence: () -> Unit,
    onMotorcycles: () -> Unit,
) {
    var tabName by rememberSaveable { mutableStateOf(RiderDestination.Home.name) }
    val tab = RiderDestination.valueOf(tabName)
    val home: HomeViewModel = hiltViewModel()
    val profile: ProfileViewModel = hiltViewModel()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, entry) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                home.refresh()
                if (entry.savedStateHandle.remove<Boolean>("refreshProfile") == true) {
                    profile.refresh(force = true)
                }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    BackHandler(enabled = tab != RiderDestination.Home) {
        tabName = (tabAfterBack(tab) ?: RiderDestination.Home).name
    }
    Scaffold(
        containerColor = RidersColors.background,
        bottomBar = {
            NavigationBar(containerColor = RidersColors.background) {
                RiderDestination.entries.forEach { destination ->
                    val selected = destination == tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = { tabName = selectRiderTab(tab, destination).name },
                        icon = {
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(if (selected) RidersColors.primary else RidersColors.border),
                            )
                        },
                        label = {
                            Text(
                                destination.label,
                                style = if (selected) RidersType.captionStrong else RidersType.caption,
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedTextColor = RidersColors.primaryDark,
                            unselectedTextColor = RidersColors.textSecondary,
                            indicatorColor = RidersColors.primaryLight,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                RiderDestination.Home -> HomeScreen(
                    onOffers = { tabName = RiderDestination.Deliveries.name },
                    onDelivery = onDelivery,
                    onSetup = onSetup,
                    inShell = true,
                    model = home,
                )
                RiderDestination.Deliveries -> DeliveriesScreen(
                    onAccepted = onAccepted,
                    onOpenDelivery = onDelivery,
                    model = home,
                )
                RiderDestination.Wallet -> WalletScreen(showBack = false, inShell = true)
                RiderDestination.Profile -> ProfileScreen(
                    onLicence = onLicence,
                    onMotorcycles = onMotorcycles,
                    onWallet = { tabName = RiderDestination.Wallet.name },
                    model = profile,
                )
            }
        }
    }
}
