package com.riders.rider.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import kotlinx.coroutines.flow.collect
import com.riders.rider.R
import com.riders.rider.core.design.LocalRidersToast
import com.riders.rider.core.design.NetworkSnackbarClearance
import com.riders.rider.core.design.RiderTransition
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersToastEvent
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.RIDER_CANCELLED_EVENT
import com.riders.rider.feature.delivery.domain.riderCancellationLanding
import com.riders.rider.core.design.rememberRidersMotion
import com.riders.rider.feature.home.DeliveriesScreen
import com.riders.rider.feature.home.HomeScreen
import com.riders.rider.feature.offers.presentation.OfferViewModel
import com.riders.rider.feature.offers.presentation.CompactRequestCard
import com.riders.rider.feature.offers.presentation.compactAvailableRequests
import com.riders.rider.feature.offers.domain.shouldPollMarketplace
import com.riders.rider.feature.offers.notification.rememberOfferInbox
import com.riders.rider.feature.offers.notification.rememberOfferPush
import com.riders.rider.feature.home.HomeViewModel
import com.riders.rider.feature.profile.domain.displayedProfilePhoto
import com.riders.rider.feature.profile.presentation.ProfileScreen
import com.riders.rider.feature.profile.presentation.ProfileViewModel
import com.riders.rider.feature.wallet.presentation.WalletScreen

private val RiderDestination.navIcon: Int
    get() = when (this) {
        RiderDestination.Home -> R.drawable.ic_nav_home
        RiderDestination.Deliveries -> R.drawable.ic_nav_deliveries
        RiderDestination.Wallet -> R.drawable.ic_nav_wallet
        RiderDestination.Profile -> R.drawable.ic_nav_more
    }

@Composable
fun RiderShell(
    entry: NavBackStackEntry,
    onDelivery: (String) -> Unit,
    onCompleted: (String) -> Unit,
    onAccepted: (String) -> Unit,
    onSetup: () -> Unit,
    onMotorcycles: () -> Unit,
) {
    var tabName by rememberSaveable { mutableStateOf(RiderDestination.Home.name) }
    var deliveriesBoard by rememberSaveable { mutableStateOf(DeliveryBoardTab.Active.name) }
    val tab = RiderDestination.valueOf(tabName)
    val showToast = LocalRidersToast.current
    LaunchedEffect(entry) {
        entry.savedStateHandle.getStateFlow<String?>(RIDER_CANCELLED_EVENT, null).collect { eventId ->
            val id = eventId?.trim().orEmpty()
            if (id.isEmpty()) {
                return@collect
            }
            entry.savedStateHandle.remove<String>(RIDER_CANCELLED_EVENT)
            val landing = riderCancellationLanding(id)
            tabName = landing.tab.name
            deliveriesBoard = landing.board.name
            showToast(RidersToastEvent(landing.eventId, landing.toastMessage))
        }
    }
    val offerPush = rememberOfferPush()
    val pendingRequests = rememberOfferInbox()
    val requestTap by pendingRequests.taps.collectAsStateWithLifecycle()
    val accountApproved by pendingRequests.approvalTaps.collectAsStateWithLifecycle()
    LaunchedEffect(requestTap) {
        val requestId = requestTap?.trim().orEmpty()
        if (requestId.isEmpty()) {
            return@LaunchedEffect
        }
        tabName = RiderDestination.Home.name
    }
    val home: HomeViewModel = hiltViewModel()
    val requests: OfferViewModel = hiltViewModel()
    LaunchedEffect(requests) {
        requests.successToasts.collect { event -> showToast(event) }
    }
    val homeUi by home.ui.collectAsStateWithLifecycle()
    val requestUi by requests.ui.collectAsStateWithLifecycle()
    var externalRequestId by rememberSaveable { mutableStateOf<String?>(null) }
    var externalBrowseRequests by rememberSaveable { mutableStateOf(false) }
    val profile: ProfileViewModel = hiltViewModel()
    LaunchedEffect(profile) {
        profile.successToasts.collect { event -> showToast(event) }
    }
    val profileUi by profile.ui.collectAsStateWithLifecycle()
    val profilePhoto = displayedProfilePhoto(profileUi.photo, profileUi.photoBitmap, profileUi.photoPreview)
    LaunchedEffect(Unit) { profile.refresh() }
    LaunchedEffect(accountApproved) {
        if (!accountApproved) {
            return@LaunchedEffect
        }
        tabName = RiderDestination.Home.name
        home.refresh()
        pendingRequests.clearApproval()
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var resumed by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ -> resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val pollRequests = resumed && (homeUi.onboarding == null || shouldPollMarketplace(true, homeUi.onboarding?.availability, homeUi.onboarding?.receiving))
    DisposableEffect(requests, resumed, pollRequests) {
        requests.setScreenResumed(resumed, pollRequests)
        onDispose { requests.setScreenResumed(false) }
    }
    val compactRequests = if (homeUi.shift.showOffers && requestUi.requestsConfirmed && resumed) compactAvailableRequests(requestUi) else emptyList()
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
    NetworkSnackbarClearance(80.dp)
    var requestOverlayVisible by remember { mutableStateOf(false) }
    com.riders.rider.core.design.NotificationSnackbarClearance(
        if (requestOverlayVisible && tab == RiderDestination.Home) 0.dp
        else if (tab != RiderDestination.Home && compactRequests.isNotEmpty()) 180.dp else 80.dp,
    )
    Scaffold(
        containerColor = RidersColors.background,
        bottomBar = {
            if (!requestOverlayVisible || tab != RiderDestination.Home) Column(Modifier.background(RidersColors.background)) {
            if (tab != RiderDestination.Home && compactRequests.isNotEmpty()) {
                CompactRequestCard(
                    offer = compactRequests.first(),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    onOpen = {
                        externalBrowseRequests = false
                        externalRequestId = compactRequests.first().deliveryId
                        tabName = RiderDestination.Home.name
                    },
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(RidersColors.border))
            NavigationBar(containerColor = RidersColors.background) {
                RiderDestination.entries.forEach { destination ->
                    val selected = destination == tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            if (destination == RiderDestination.Deliveries) {
                                deliveriesBoard = DeliveryBoardTab.Active.name
                            }
                            tabName = destination.name
                        },
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
            }
        },
    ) { padding ->
        val motion = rememberRidersMotion()
        val tabMs = motion.millis(RiderTransition.TabFade)
        Box(Modifier.padding(padding).fillMaxSize()) {
            AnimatedContent(
                targetState = tab,
                transitionSpec = {
                    val forward = targetState.ordinal > initialState.ordinal
                    ContentTransform(
                        targetContentEnter = if (forward) deliveryForwardEnter(tabMs) else deliveryBackEnter(tabMs),
                        initialContentExit = if (forward) deliveryForwardExit(tabMs) else deliveryBackExit(tabMs),
                        sizeTransform = null,
                    )
                },
                label = "rider-tabs",
            ) { destination ->
                when (destination) {
                    RiderDestination.Home -> HomeScreen(
                        onOffers = { tabName = RiderDestination.Deliveries.name },
                        onActiveDeliveries = {
                            deliveriesBoard = DeliveryBoardTab.Active.name
                            tabName = RiderDestination.Deliveries.name
                        },
                        onWallet = { tabName = RiderDestination.Wallet.name },
                        onDelivery = onDelivery,
                        onSetup = onSetup,
                        inShell = true,
                        homeSelected = tab == RiderDestination.Home,
                        externalRequestId = externalRequestId,
                        externalBrowseRequests = externalBrowseRequests,
                        onExternalRequestConsumed = { externalRequestId = null; externalBrowseRequests = false },
                        onRequestOverlayVisible = { requestOverlayVisible = it },
                        profilePhoto = profilePhoto,
                        model = home,
                        offersModel = requests,
                    )
                    RiderDestination.Deliveries -> DeliveriesScreen(
                        onAccepted = onAccepted,
                        onOpenDelivery = onDelivery,
                        onOpenCompleted = onCompleted,
                        boardTab = deliveryBoardTab(deliveriesBoard),
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
}
