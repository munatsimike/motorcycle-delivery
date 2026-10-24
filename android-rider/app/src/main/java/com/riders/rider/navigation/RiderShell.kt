package com.riders.rider.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.home.DeliveriesScreen
import com.riders.rider.feature.home.HomeScreen
import com.riders.rider.feature.offers.notification.rememberOfferInbox
import com.riders.rider.feature.offers.notification.rememberOfferPush
import com.riders.rider.feature.home.HomeViewModel
import com.riders.rider.feature.profile.presentation.ProfileScreen
import com.riders.rider.feature.profile.presentation.ProfileViewModel
import com.riders.rider.feature.wallet.presentation.WalletScreen

private val RiderDestination.navIcon: Int
    get() = when (this) {
        RiderDestination.Home -> R.drawable.ic_nav_home
        RiderDestination.Deliveries -> R.drawable.ic_nav_deliveries
        RiderDestination.Wallet -> R.drawable.ic_nav_wallet
        RiderDestination.Profile -> R.drawable.ic_nav_profile
    }

@Composable
fun RiderShell(
    entry: NavBackStackEntry,
    onDelivery: (String) -> Unit,
    onAccepted: (String) -> Unit,
    onSetup: () -> Unit,
    onMotorcycles: () -> Unit,
) {
    var tabName by rememberSaveable { mutableStateOf(RiderDestination.Home.name) }
    val tab = RiderDestination.valueOf(tabName)
    val pending = rememberOfferInbox()
    val offerPush = rememberOfferPush()
    val offerTap by pending.taps.collectAsStateWithLifecycle()
    LaunchedEffect(offerTap) {
        if (offerTap != null) {
            tabName = RiderDestination.Deliveries.name
        }
    }
    val home: HomeViewModel = hiltViewModel()
    val profile: ProfileViewModel = hiltViewModel()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, entry) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                home.refresh()
                offerPush.onHome()
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
                            Icon(
                                painter = painterResource(destination.navIcon),
                                contentDescription = null,
                                modifier = Modifier.size(24.dp),
                            )
                        },
                        label = {
                            Text(
                                destination.label,
                                style = RidersType.small.copy(fontWeight = FontWeight.Light),
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = RidersColors.primary,
                            unselectedIconColor = RidersColors.textSecondary,
                            selectedTextColor = RidersColors.primary,
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
                    onWallet = { tabName = RiderDestination.Wallet.name },
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
                    onMotorcycles = onMotorcycles,
                    model = profile,
                )
            }
        }
    }
}
