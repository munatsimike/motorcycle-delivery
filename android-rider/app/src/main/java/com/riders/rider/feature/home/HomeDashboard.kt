package com.riders.rider.feature.home

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersAvailability
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogActions
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTextButton
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersDialogTone
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersNetworkNotice
import com.riders.rider.core.design.isConnectionFailure
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersMotion
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.rememberRidersMotion
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersStatusIndicator
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.presentation.DeliverySummaryCard
import com.riders.rider.feature.delivery.presentation.MapBackground
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.offers.domain.RequestOverlay
import com.riders.rider.feature.offers.presentation.OfferRequestCard
import com.riders.rider.feature.offers.presentation.OfferViewModel
import com.riders.rider.feature.offers.presentation.RequestMapOverlay
import kotlinx.coroutines.delay
import com.riders.rider.feature.offers.domain.opensDeliveriesAfterListedOffer
import com.riders.rider.feature.offers.domain.senderChoosesRider
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.displayedBidProblem
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.resolvedSubmittedAmount
import com.riders.rider.feature.offers.domain.shouldAskNotificationPermission
import com.riders.rider.feature.offers.notification.markNotificationPermissionAsked
import com.riders.rider.feature.offers.notification.notificationPermissionWasAsked
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.needsOnboarding
import com.riders.rider.feature.wallet.domain.WALLET_TOP_UP_REQUIRED
import com.riders.rider.feature.wallet.domain.signedWalletLabel
import com.riders.rider.feature.wallet.domain.walletBalanceIsNegative
import java.util.Calendar

@Composable
fun HomeScreen(
    onOffers: () -> Unit,
    onActiveDeliveries: () -> Unit = onOffers,
    onNewRequests: () -> Unit = onOffers,
    onWallet: () -> Unit = {},
    onDelivery: (String) -> Unit,
    onSetup: () -> Unit = {},
    inShell: Boolean = false,
    onRequestOverlayVisible: (Boolean) -> Unit = {},
    profilePhoto: Bitmap? = null,
    model: HomeViewModel = hiltViewModel(),
    offersModel: OfferViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val offersUi by offersModel.ui.collectAsStateWithLifecycle()
    DisposableEffect(model) {
        model.watchOffers(true)
        onDispose { model.watchOffers(false) }
    }
    var confirmOffline by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val availability = ui.onboarding?.availability
    val availabilityNow = rememberUpdatedState(availability)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            val sharing = availabilityNow.value == "AVAILABLE" || availabilityNow.value == "BUSY"
            if (sharing) {
                model.retryLocationSharing()
            } else {
                model.goOnline()
            }
        } else {
            model.locationPermissionDenied()
        }
    }
    var locationPrompted by remember { mutableStateOf(false) }
    LaunchedEffect(availability) {
        val sharing = availability == "AVAILABLE" || availability == "BUSY"
        if (!sharing) {
            return@LaunchedEffect
        }
        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (allowed) {
            model.retryLocationSharing()
        } else if (!locationPrompted) {
            locationPrompted = true
            permission.launch(locationPermissions())
        }
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (shouldAskNotificationPermission(Build.VERSION.SDK_INT, granted, notificationPermissionWasAsked(context))) {
            markNotificationPermissionAsked(context)
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    var overlay by remember { mutableStateOf(RequestOverlay()) }
    val eligibleIds = if (ui.shift.showOffers) ui.offers.map { it.deliveryId } else emptyList()
    LaunchedEffect(eligibleIds, confirmOffline, overlay) {
        val next = overlay.sync(eligibleIds, blocked = confirmOffline)
        if (next != overlay) {
            overlay = next
        }
    }
    val shownRequest = ui.offers.firstOrNull { it.deliveryId == overlay.openId }
    SideEffect { onRequestOverlayVisible(shownRequest != null) }
    var requestNow by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(shownRequest?.deliveryId) {
        if (shownRequest == null) {
            return@LaunchedEffect
        }
        while (true) {
            requestNow = System.currentTimeMillis()
            delay(1_000)
        }
    }
    LaunchedEffect(offersUi.accepted?.deliveryId, overlay.openId) {
        val acceptedId = offersUi.accepted?.deliveryId
        if (acceptedId != null && acceptedId == overlay.openId) {
            overlay = overlay.copy(openId = null)
            onOffers()
        }
    }
    Box(Modifier.fillMaxSize()) {
    HomeDashboard(
        ui = ui,
        profilePhoto = profilePhoto,
        greeting = ridersGreeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)),
        onGoOnline = {
            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (allowed) {
                model.goOnline()
            } else {
                permission.launch(locationPermissions())
            }
        },
        onGoOffline = {
            val count = activeDeliveryCount(ui.shift.showActiveDelivery, ui.flexibleCount, ui.expressCount)
            if (offlineConfirmationRequired(count)) {
                confirmOffline = true
            } else {
                model.goOffline()
            }
        },
        onOffers = onOffers,
        onActiveDeliveries = onActiveDeliveries,
        onNewRequests = onNewRequests,
        onAcceptOffer = { offer ->
            if (senderChoosesRider(offer.serviceClass)) {
                offersModel.offerListedPrice(offer)
            } else {
                offersModel.accept(offer)
                onOffers()
            }
        },
        onBidOffer = { offer ->
            if (opensDeliveriesAfterListedOffer(offer.serviceClass)) {
                offersModel.openBid(offer)
                onOffers()
            }
        },
        onSubmitBid = { offer, amount ->
            offersModel.submitBid(offer.deliveryId, amount, offer.currency)
        },
        onInterestOffer = offersModel::expressInterest,
        onOpenRequest = { offer -> overlay = overlay.open(offer.deliveryId) },
        offerAccepting = offersUi.accepting,
        offerSubmitting = offersUi.submittingBid,
        offerBidError = offersUi.bidError,
        offerListError = offersUi.bidListError,
        offerBidsKnown = offersUi.ownBidsKnown,
        offerStatus = offersUi.sentLabels,
        offerAmounts = offersUi.sentAmounts,
        offerBids = offersUi.ownBids,
        onWallet = onWallet,
        onDelivery = onDelivery,
        onRefresh = model::refresh,
        onRetryLocation = {
            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (allowed) {
                model.retryLocationSharing()
            } else {
                permission.launch(locationPermissions())
            }
        },
        onSetup = onSetup,
        includeNavigationBars = !inShell,
        inShell = inShell,
    )
    if (shownRequest != null) {
        BackHandler { overlay = overlay.dismiss() }
        val sentAmount = resolvedSubmittedAmount(offersUi.ownBids, shownRequest.deliveryId, offersUi.sentAmounts[shownRequest.deliveryId])
        RequestMapOverlay(
            offer = shownRequest,
            nowMillis = requestNow,
            accepting = offersUi.accepting,
            submittingBid = offersUi.submittingBid,
            statusLabel = if (sentAmount == null) offersUi.sentLabels[shownRequest.deliveryId] else null,
            sentAmount = sentAmount,
            bidsOpen = marketplaceBidButtonsVisible(shownRequest.serviceClass, offersUi.ownBidsKnown, offersUi.bidError ?: offersUi.bidListError),
            error = offersUi.error ?: offersUi.bidError,
            onAccept = {
                if (senderChoosesRider(shownRequest.serviceClass)) {
                    offersModel.offerListedPrice(shownRequest)
                } else {
                    offersModel.accept(shownRequest)
                }
            },
            onBid = { offersModel.openBid(shownRequest) },
            onSubmitBid = { amount -> offersModel.submitBid(shownRequest.deliveryId, amount, shownRequest.currency) },
            onInterest = { offersModel.expressInterest(shownRequest) },
            onClose = { overlay = overlay.dismiss() },
        )
    }
    if (confirmOffline) {
        RidersDialog(visible = true, onDismiss = { confirmOffline = false }) {
            RidersDialogTitle(OFFLINE_WITH_DELIVERIES_TITLE)
            RidersDialogBody(OFFLINE_WITH_DELIVERIES_MESSAGE)
            RidersDialogActions {
                RidersDialogTextButton(
                    label = "Stay online",
                    tone = RidersDialogTone.Neutral,
                    onClick = { confirmOffline = false },
                )
                RidersDialogTextButton(
                    label = "Go offline",
                    onClick = {
                        confirmOffline = false
                        model.goOffline()
                    },
                )
            }
        }
    }
    }
}

@Composable
private fun LocationSharingPausedNotice(onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.dangerSurface)
            .padding(RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Text("Location sharing paused", style = RidersType.bodyStrong, color = RidersColors.text)
        Text(
            "We couldn't update your location. Check your connection or location permission.",
            style = RidersType.caption,
            color = RidersColors.textSecondary,
        )
        RidersSecondaryButton(label = "Retry", onClick = onRetry, compact = true)
    }
}

@Composable
fun HomeDashboard(
    ui: HomeUi,
    profilePhoto: Bitmap? = null,
    greeting: String,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onOffers: () -> Unit,
    onActiveDeliveries: () -> Unit = onOffers,
    onNewRequests: () -> Unit = onOffers,
    onAcceptOffer: (OfferResponse) -> Unit = {},
    onBidOffer: (OfferResponse) -> Unit = {},
    onSubmitBid: (OfferResponse, String) -> Unit = { _, _ -> },
    onInterestOffer: (OfferResponse) -> Unit = {},
    onOpenRequest: (OfferResponse) -> Unit = {},
    offerAccepting: Boolean = false,
    offerSubmitting: Boolean = false,
    offerBidError: String? = null,
    offerListError: String? = null,
    offerBidsKnown: Boolean = false,
    offerStatus: Map<String, String> = emptyMap(),
    offerAmounts: Map<String, String> = emptyMap(),
    offerBids: List<OwnBid> = emptyList(),
    onDelivery: (String) -> Unit = { _ -> },
    onRefresh: () -> Unit = {},
    onRetryLocation: () -> Unit = {},
    onSetup: () -> Unit = {},
    onWallet: () -> Unit = {},
    includeNavigationBars: Boolean = true,
    inShell: Boolean = false,
) {
    var contentBottom by remember { mutableFloatStateOf(0f) }
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(RidersColors.canvas)
            .onGloballyPositioned { coords ->
                val position = coords.positionInRoot()
                contentBottom = position.y + coords.size.height
            },
    ) {
        val horizontal = RidersSpacing.lg
        val readiness = ui.readiness
        val statusTop = with(LocalDensity.current) { WindowInsets.statusBars.getTop(this).toDp() }
        val topInset = if (inShell) 0.dp else statusTop
        val headerHeight = topInset + 200.dp
        RidersPullRefresh(
            refreshing = ui.refreshing && readiness != null,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .then(if (includeNavigationBars) Modifier.navigationBarsPadding() else Modifier),
        ) {
            Box(Modifier.fillMaxWidth()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(headerHeight)
                        .clipToBounds(),
                ) {
                    MapBackground(Modifier.fillMaxSize())
                    Box(
                        Modifier
                            .matchParentSize()
                            .background(
                                Brush.verticalGradient(
                                    0f to RidersColors.mintStart.copy(alpha = 0.72f),
                                    0.62f to RidersColors.mintMid.copy(alpha = 0.35f),
                                    1f to RidersColors.mintEnd.copy(alpha = 0.55f),
                                ),
                            ),
                    )
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .then(if (inShell) Modifier else Modifier.statusBarsPadding())
                            .padding(top = RidersSpacing.md)
                            .padding(horizontal = horizontal),
                        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RiderInitialsAvatar(ui.fullName, profilePhoto)
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                        ) {
                            Text(
                                greeting,
                                style = RidersType.caption.copy(fontWeight = FontWeight.SemiBold),
                                color = RidersColors.text,
                            )
                            riderFirstName(ui.fullName)?.let { firstName ->
                                Text(
                                    firstName,
                                    style = RidersType.heading.copy(fontWeight = FontWeight.SemiBold),
                                    color = RidersColors.text,
                                )
                            }
                        }
                    }
                }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = topInset + 76.dp),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                ) {
                    Column(Modifier.padding(horizontal = horizontal)) {
                    when {
                        ui.loading && readiness == null -> RidersLoadingState("Checking your account")
                        readiness == null -> RidersFailureNotice(
                            message = ui.error ?: "Your account could not be loaded. Check your connection and try again.",
                            title = "Connection unavailable",
                            onRetry = onRefresh,
                        )
                        else -> AvailabilityCard(
                            readiness = readiness,
                            loading = ui.loading,
                            changingAvailability = ui.changingAvailability,
                            pendingOnline = ui.pendingOnline,
                            showFinishSetup = ui.onboarding != null && needsOnboarding(ui.onboarding) && !readiness.canGoOnline && !ui.applicationSubmitted,
                            showViewApplication = ui.applicationSubmitted,
                            showGoOnline = ui.shift.showGoOnline && readiness.canGoOnline,
                            showGoOffline = ui.shift.showGoOffline,
                            onGoOnline = onGoOnline,
                            onGoOffline = onGoOffline,
                            onSetup = onSetup,
                        )
                    }
                    }
                    if (readiness != null) {
                        HomeSummaries(
                            balance = ui.walletBalance,
                            currency = ui.walletCurrency,
                            restricted = ui.walletRestricted,
                            activeCount = ui.activeDeliveryTotal,
                            newRequestCount = ui.activeRequestCount,
                            onWallet = onWallet,
                            onActive = onActiveDeliveries,
                            onNew = onNewRequests,
                            modifier = Modifier.padding(horizontal = horizontal),
                        )
                    }
                }
            }
            Spacer(Modifier.height(RidersSpacing.xl))
            if (readiness != null) {
                Column(
                    Modifier.padding(bottom = RidersSpacing.lg),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                ) {
                    if (ui.locationSharingPaused) {
                        LocationSharingPausedNotice(
                            onRetry = onRetryLocation,
                            modifier = Modifier.padding(horizontal = horizontal),
                        )
                    }
                    val recoveryText = if (ui.shift.recoveryFailed) {
                        ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again."
                    } else {
                        null
                    }
                    val pageConnection = isConnectionFailure(ui.error) || isConnectionFailure(recoveryText)
                    if (pageConnection) {
                        RidersNetworkNotice(onRetry = onRefresh, modifier = Modifier.padding(horizontal = horizontal))
                    }
                    if (!ui.assignmentsUnknown) {
                        RequestsSection(
                            ui,
                            onNewRequests,
                            onAcceptOffer,
                            onBidOffer,
                            onSubmitBid,
                            onInterestOffer,
                            onOpenRequest,
                            offerAccepting,
                            offerSubmitting,
                            offerBidError,
                            offerListError,
                            offerBidsKnown,
                            offerStatus,
                            offerAmounts,
                            offerBids,
                            horizontal = horizontal,
                            contentBottom = contentBottom,
                        )
                    }
                    if (ui.error != null && ui.error != ui.shift.recoveryMessage && !isConnectionFailure(ui.error)) {
                        RidersErrorState(message = ui.error, modifier = Modifier.padding(horizontal = horizontal))
                    }
                    Spacer(Modifier.height(RidersSpacing.lg))
                }
            }
        }
        }
    }
}

@Composable
private fun RiderInitialsAvatar(fullName: String, photo: Bitmap?) {
    val initials = riderInitials(fullName)
    val palette = riderAvatarColors(fullName)
    Box(
        Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(palette.background),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                bitmap = photo.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                initials,
                color = palette.foreground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private fun riderFirstName(fullName: String): String? {
    return fullName.trim().split(Regex("\\s+")).firstOrNull { it.isNotEmpty() }
}

private fun riderInitials(fullName: String): String {
    val letters = fullName.trim().split(Regex("\\s+")).mapNotNull { word ->
        word.firstOrNull { it.isLetter() }?.uppercase(Locale.ENGLISH)
    }
    return when {
        letters.isEmpty() -> "R"
        letters.size == 1 -> letters.first()
        else -> letters.first() + letters.last()
    }
}

private data class AvatarPalette(val background: Color, val foreground: Color)

private val avatarPalettes = listOf(
    AvatarPalette(Color(0xFF3D5A80), RidersColors.textInverse),
    AvatarPalette(Color(0xFFC46B4A), RidersColors.textInverse),
    AvatarPalette(Color(0xFF6B5478), RidersColors.textInverse),
    AvatarPalette(Color(0xFFF3E6D8), RidersColors.text),
)

private fun riderAvatarColors(fullName: String): AvatarPalette {
    if (fullName.isBlank()) {
        return avatarPalettes.first()
    }
    var hash = 0
    for (character in fullName) {
        hash = ((hash.toLong() * 31 + character.code) and 0xFFFFFFFFL).toInt()
    }
    return avatarPalettes[(hash.toUInt() % avatarPalettes.size.toUInt()).toInt()]
}

@Composable
private fun HomeSummaries(
    balance: String?,
    currency: String?,
    restricted: Boolean,
    activeCount: Int?,
    newRequestCount: Int?,
    onWallet: () -> Unit,
    onActive: () -> Unit,
    onNew: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SummaryTile(
                icon = R.drawable.ic_plus,
                label = "New",
                value = newRequestCount?.toString() ?: "—",
                valueColor = if ((newRequestCount ?: 0) > 0) RidersColors.primaryDark else RidersColors.text,
                onClick = onNew,
                modifier = Modifier.weight(1f),
            )
            SummaryTile(
                icon = R.drawable.ic_nav_deliveries,
                label = "Active",
                value = activeCount?.toString() ?: "—",
                onClick = onActive,
                modifier = Modifier.weight(1f),
            )
            SummaryTile(
                icon = R.drawable.ic_nav_wallet,
                label = "Balance",
                value = if (balance != null && currency != null) signedWalletLabel(currency, balance) else "—",
                valueColor = if (balance != null && walletBalanceIsNegative(balance)) RidersColors.error else RidersColors.text,
                onClick = onWallet,
                modifier = Modifier.weight(1.25f),
            )
        }
        if (restricted) {
            Text(
                WALLET_TOP_UP_REQUIRED,
                style = RidersType.caption,
                color = RidersColors.error,
            )
        }
    }
}

@Composable
private fun SummaryTile(
    icon: Int,
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    valueColor: Color = RidersColors.text,
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val valueSize = when {
        value.length > 9 -> 13.sp
        value.length > 7 -> 15.sp
        else -> 20.sp
    }
    Column(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 96.dp)
            .clip(shape)
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
    ) {
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(RidersColors.primaryLight),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(icon),
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = RidersColors.primaryDark,
            )
        }
        Text(
            value,
            modifier = Modifier.fillMaxWidth(),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = RidersType.heading.copy(
                fontSize = valueSize,
                lineHeight = valueSize,
                fontWeight = FontWeight.Bold,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
            ),
            color = valueColor,
            textAlign = TextAlign.Center,
        )
        Text(
            label,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = RidersType.caption.copy(
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.SemiBold,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
            ),
            color = RidersColors.textSecondary,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun AvailabilityCard(
    readiness: RiderReadiness,
    loading: Boolean,
    changingAvailability: Boolean,
    pendingOnline: Boolean? = null,
    showFinishSetup: Boolean,
    showViewApplication: Boolean,
    showGoOnline: Boolean,
    showGoOffline: Boolean,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onSetup: () -> Unit,
) {
    var heldOnline by remember { mutableStateOf<Boolean?>(null) }
    SideEffect {
        heldOnline = when {
            pendingOnline != null -> pendingOnline
            changingAvailability && heldOnline != null -> heldOnline
            changingAvailability -> showGoOnline
            else -> null
        }
    }
    val goingOnline = changingAvailability && (pendingOnline ?: heldOnline) == true
    val goingOffline = changingAvailability && (pendingOnline ?: heldOnline) == false
    val displayGoOnline = showGoOnline || goingOnline
    val displayGoOffline = (showGoOffline || goingOffline) && !goingOnline
    val onlineNow = !goingOnline &&
        (readiness.availabilityLabel == "Online" || readiness.availabilityLabel == "Available")
    val statusTitle = RidersType.heading.copy(
        fontSize = 18.sp,
        lineHeight = 22.sp,
        platformStyle = PlatformTextStyle(includeFontPadding = false),
    )
    RidersCard(
        prominent = true,
        containerColor = RidersColors.background,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                    horizontalAlignment = Alignment.Start,
                ) {
                    if (onlineNow) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF3DAF78)),
                            )
                            Text("You are online", style = statusTitle, color = RidersColors.text)
                        }
                        Text(
                            "Stay online to receive delivery requests.",
                            style = RidersType.body,
                            color = RidersColors.textSecondary,
                        )
                    } else if (readiness.canGoOnline) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(RidersColors.textSecondary),
                            )
                            Text("You are offline", style = statusTitle, color = RidersColors.text)
                        }
                        Text(
                            "You cannot accept deliveries.",
                            style = RidersType.body,
                            color = RidersColors.textSecondary,
                        )
                    } else if (readiness.approvalLabel == "Pending") {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(RidersColors.textSecondary),
                            )
                            Text("You are offline", style = statusTitle, color = RidersColors.text)
                        }
                        Text(
                            "Your account is waiting for approval",
                            style = RidersType.body,
                            color = RidersColors.textSecondary,
                        )
                    } else {
                        RidersStatusIndicator(availabilityFor(readiness))
                        Text(readiness.message, style = RidersType.body, color = RidersColors.text)
                    }
                }
                Image(
                    painter = painterResource(R.drawable.rider_cutout),
                    contentDescription = null,
                    modifier = Modifier
                        .width(112.dp)
                        .height(96.dp),
                    contentScale = ContentScale.Fit,
                )
            }
            if (showViewApplication) {
                RidersSecondaryButton(
                    label = "View application",
                    onClick = onSetup,
                    enabled = !loading,
                    icon = R.drawable.ic_file_document_outline,
                    bordered = false,
                    containerColor = RidersColors.surface,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (showFinishSetup) {
                RidersPrimaryButton(
                    label = "Finish setup",
                    onClick = onSetup,
                    enabled = !loading,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (displayGoOnline) {
                val motion = rememberRidersMotion()
                var shown by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) { shown = true }
                val appear by animateFloatAsState(
                    targetValue = if (shown) 1f else 0f,
                    animationSpec = tween(
                        durationMillis = motion.duration(RidersMotion.DELIVERY_MS),
                        easing = FastOutSlowInEasing,
                    ),
                    label = "go-online-appear",
                )
                RidersPrimaryButton(
                    label = "Go online",
                    onClick = onGoOnline,
                    enabled = !loading && !changingAvailability,
                    loading = goingOnline,
                    loadingLabel = "Going online…",
                    icon = R.drawable.ic_power,
                    modifier = Modifier
                        .graphicsLayer {
                            alpha = appear
                            val scale = 0.98f + 0.02f * appear
                            scaleX = scale
                            scaleY = scale
                        }
                        .fillMaxWidth()
                        .heightIn(min = 56.dp),
                )
            }
            if (displayGoOffline) {
                RidersSecondaryButton(
                    label = "Go offline",
                    onClick = onGoOffline,
                    enabled = !loading && !changingAvailability,
                    loading = goingOffline,
                    loadingLabel = "Going offline…",
                    icon = R.drawable.ic_power,
                    bordered = false,
                    compact = !goingOffline,
                    containerColor = RidersColors.surface,
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(if (goingOffline) Modifier.heightIn(min = 56.dp) else Modifier),
                )
            }
        }
    }
}

@Composable
internal fun ActiveDeliverySection(
    ui: HomeUi,
    onDelivery: (String) -> Unit,
    suppressConnection: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Text("Active delivery", style = RidersType.heading, color = RidersColors.text)
        val recoveryMessage = ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again."
        val hideRecovery = suppressConnection && isConnectionFailure(recoveryMessage)
        when {
            ui.shift.recovering -> RidersLoadingState("Checking your active delivery")
            ui.shift.recoveryFailed && !hideRecovery -> RidersFailureNotice(
                message = recoveryMessage,
                title = "Connection unavailable",
            )
            ui.shift.recoveryRequired -> RidersCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    ui.shift.recoveryMessage ?: "You are marked as busy, but there is no active delivery to resume. You cannot go online.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            }
            ui.shift.showActiveDelivery && ui.active != null -> ActiveDeliveryCard(ui.active, onDelivery)
            ui.shift.recoveryFailed -> Unit
            else -> RidersEmptyState(
                title = "No active delivery",
                body = "There is no delivery to resume.",
            )
        }
    }
}

@Composable
private fun ActiveDeliveryCard(active: ActiveDelivery, onDelivery: (String) -> Unit) {
    DeliverySummaryCard(
        description = active.parcelDescription,
        serviceClass = active.serviceClass,
        status = active.status,
        pickup = active.pickupAddress,
        dropoff = active.dropoffAddress,
        onClick = { onDelivery(active.deliveryId) },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RequestsSection(
    ui: HomeUi,
    onOffers: () -> Unit,
    onAcceptOffer: (OfferResponse) -> Unit,
    onBidOffer: (OfferResponse) -> Unit,
    onSubmitBid: (OfferResponse, String) -> Unit,
    onInterestOffer: (OfferResponse) -> Unit,
    onOpenRequest: (OfferResponse) -> Unit,
    offerAccepting: Boolean,
    offerSubmitting: Boolean,
    offerBidError: String?,
    offerListError: String?,
    offerBidsKnown: Boolean,
    offerStatus: Map<String, String>,
    offerAmounts: Map<String, String>,
    offerBids: List<OwnBid>,
    horizontal: Dp,
    contentBottom: Float,
) {
    val shown = ui.offers.take(2)
    val hasRequests = ui.shift.showOffers && shown.isNotEmpty()
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(hasRequests) {
        while (hasRequests) {
            nowMillis = System.currentTimeMillis()
            delay(1_000)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = horizontal),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "New requests",
                style = RidersType.heading.copy(
                    lineHeight = 24.sp,
                    platformStyle = PlatformTextStyle(includeFontPadding = false),
                ),
                color = RidersColors.text,
            )
            Text(
                "View all",
                style = RidersType.button,
                color = RidersColors.primary,
                modifier = Modifier.clickable(role = Role.Button, onClick = onOffers),
            )
        }
        if (hasRequests) {
            Column(
                Modifier
                    .padding(horizontal = horizontal),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
            shown.forEach { offer ->
                val sentAmount = resolvedSubmittedAmount(offerBids, offer.deliveryId, offerAmounts[offer.deliveryId])
                OfferRequestCard(
                    offer,
                    nowMillis,
                    accepting = offerAccepting,
                    submittingBid = offerSubmitting,
                    statusLabel = if (sentAmount == null) offerStatus[offer.deliveryId] else null,
                    sentAmount = sentAmount,
                    bidsOpen = marketplaceBidButtonsVisible(offer.serviceClass, offerBidsKnown, offerBidError ?: offerListError),
                    onAccept = { onAcceptOffer(offer) },
                    onBid = { onBidOffer(offer) },
                    onSubmitBid = { amount -> onSubmitBid(offer, amount) },
                    onInterest = { onInterestOffer(offer) },
                    onOpen = { onOpenRequest(offer) },
                )
            }
            val bidProblem = displayedBidProblem(
                hasMarketplaceRequest = shown.any { it.serviceClass == "EXPRESS" || it.serviceClass == "FLEXIBLE" },
                listProblem = offerListError,
                submitProblem = offerBidError,
            )
            if (bidProblem != null) {
                RidersFailureNotice(message = bidProblem)
            }
            }
        } else {
            HomeEmptyBackdrop(contentBottom = contentBottom) {
                RidersEmptyState(
                    title = "No requests",
                    body = "New delivery requests will appear here.",
                    image = R.drawable.parcel_box,
                    compactTop = true,
                    showSurface = false,
                )
            }
        }
    }
}

@Composable
private fun HomeEmptyBackdrop(contentBottom: Float, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val fade = 72.dp
    var top by remember { mutableFloatStateOf(0f) }
    Box(
        Modifier
            .fillMaxWidth()
            .onGloballyPositioned { top = it.positionInRoot().y }
            .drawBehind {
                val overlap = with(density) { 8.dp.toPx() }
                val target = contentBottom + overlap
                val extra = target - top - size.height
                if (extra > 0f) {
                    drawRect(
                        color = RidersColors.background,
                        topLeft = Offset(0f, size.height),
                        size = Size(size.width, extra),
                    )
                }
            },
    ) {
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.55f to RidersColors.background,
                        1f to RidersColors.background,
                        startY = 0f,
                        endY = with(density) { fade.toPx() },
                    ),
                ),
        )
        Box(Modifier.fillMaxWidth().padding(top = RidersSpacing.lg)) {
            content()
        }
    }
}

private fun availabilityFor(readiness: RiderReadiness): RidersAvailability = when (readiness.availabilityLabel) {
    "Online", "Available", "On a delivery" -> RidersAvailability.Available
    else -> RidersAvailability.Offline
}

internal fun ridersGreeting(hour: Int): String = when {
    hour < 12 -> "Good morning"
    hour < 17 -> "Good afternoon"
    else -> "Good evening"
}

private fun locationPermissions(): Array<String> {
    return arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )
}

@Preview(name = "Offline approved", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOfflineApproved() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(offlineReady()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Available", showBackground = true, widthDp = 360)
@Composable
private fun PreviewAvailable() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(availableReady()),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Busy", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusy() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(busyReady(), active = sampleDelivery()),
            greeting = "Good evening",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Pending approval", showBackground = true, widthDp = 360)
@Composable
private fun PreviewPending() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(pendingApproval()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Rejected licence", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRejectedLicence() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(rejectedLicence()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Unverified motorcycle", showBackground = true, widthDp = 360)
@Composable
private fun PreviewMotorcycle() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(unverifiedMotorcycle()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun PreviewLoading() {
    RiderTheme {
        HomeDashboard(
            ui = HomeUi(loading = true),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Recovery failed", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRecoveryFailed() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            ui = previewUi(readiness).copy(
                shift = homeShift("BUSY", readiness.canAcceptDeliveries, null, recoveryFailed = true),
            ),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Busy without delivery", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusyWithoutDelivery() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            ui = previewUi(readiness).copy(active = null, shift = homeShift("BUSY", false, null)),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Small phone", showBackground = true, widthDp = 320, fontScale = 1.3f)
@Composable
private fun PreviewSmallPhone() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(offlineReady()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

private fun previewUi(readiness: RiderReadiness, active: ActiveDelivery? = null): HomeUi {
    val onboarding = RiderOnboarding(
        licenceVerificationStatus = when (readiness.licenceLabel) {
            "Verified" -> "VERIFIED"
            "Rejected" -> "REJECTED"
            else -> "PENDING"
        },
        approvalStatus = when (readiness.approvalLabel) {
            "Approved" -> "APPROVED"
            "Suspended" -> "SUSPENDED"
            "Rejected" -> "REJECTED"
            else -> "PENDING"
        },
        availability = when (readiness.availabilityLabel) {
            "Online", "Available" -> "AVAILABLE"
            else -> "OFFLINE"
        },
        licenceNumber = null,
        licenceClass = null,
        rejectionReason = null,
        verifiedMotorcycleCount = if (readiness.message.contains("motorcycle")) 0 else 1,
        activeVerifiedMotorcycle = !readiness.message.contains("motorcycle"),
    )
    return HomeUi(
        loading = false,
        onboarding = onboarding,
        readiness = readiness,
        active = active,
        shift = homeShift(onboarding.availability, readiness.canAcceptDeliveries, active),
        fullName = "Tonderai Moyo",
    )
}

private fun offlineReady() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = true,
    availabilityLabel = "Offline",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "Your account is approved. You are offline, so you cannot accept deliveries yet.",
)

private fun availableReady() = RiderReadiness(
    canAcceptDeliveries = true,
    canGoOnline = false,
    availabilityLabel = "Online",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You are online. Delivery requests appear while you stay available.",
)

private fun busyReady() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Online",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You are online. Delivery requests appear while you stay available.",
)

private fun pendingApproval() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Pending review",
    approvalLabel = "Pending",
    message = "Your account is waiting for approval. You cannot accept deliveries yet.",
)

private fun rejectedLicence() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Rejected",
    approvalLabel = "Approved",
    message = "Your licence was rejected: Photo is unreadable",
)

private fun unverifiedMotorcycle() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You need an active verified motorcycle before you can accept deliveries.",
)

private fun sampleDelivery() = ActiveDelivery(
    deliveryId = "delivery-1",
    assignmentId = "assignment-1",
    status = "ASSIGNED",
    parcelDescription = "Documents",
    pickupAddress = "Samora Machel Avenue, Harare",
    dropoffAddress = "Borrowdale Road, Harare",
)
