package com.riders.rider.feature.home

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
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
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.feature.availability.domain.LocationNotice
import com.riders.rider.feature.availability.domain.LocationPermissionAction
import com.riders.rider.feature.availability.domain.locationPermissionAction
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersAvailability
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogActions
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.NetworkAvailability
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersNetworkNotice
import com.riders.rider.core.design.isConnectionFailure
import com.riders.rider.core.design.networkWarningPending
import com.riders.rider.core.design.rememberNetworkStatus
import com.riders.rider.core.design.RidersCenteredContent
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersMotion
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.rememberRidersMotion
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.refresh.goOnlineEnabled
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersStatusIndicator
import com.riders.rider.core.design.LocalRidersToast
import com.riders.rider.core.design.RidersToastEvent
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.offers.domain.OfferActionProgress
import com.riders.rider.feature.offers.domain.RequestOverlay
import com.riders.rider.feature.offers.domain.autoOpenRequestIds
import com.riders.rider.feature.offers.domain.dismissedForSettledAttempts
import com.riders.rider.feature.offers.domain.handleRequestMapSuccess
import com.riders.rider.feature.offers.domain.cachedNotificationOffer
import com.riders.rider.feature.offers.domain.offerSentToast
import com.riders.rider.feature.offers.domain.overlayAfterSearchAttempt
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.closeExpiredRequest
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.requestAttemptIdentity
import com.riders.rider.feature.offers.domain.retainOpenRequest
import com.riders.rider.feature.offers.domain.requestMapNotice
import com.riders.rider.feature.offers.domain.requestMapAutoOpenBlocked
import com.riders.rider.feature.offers.domain.requestSettled
import com.riders.rider.feature.offers.domain.sealDismissedAttempt
import com.riders.rider.feature.offers.presentation.OfferRequestCard
import com.riders.rider.feature.offers.presentation.OfferViewModel
import com.riders.rider.feature.offers.notification.rememberOfferInbox
import com.riders.rider.feature.offers.presentation.RequestMapOverlay
import com.riders.rider.feature.offers.domain.senderChoosesRider
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.displayedBidProblem
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.notificationBidRequest
import com.riders.rider.feature.bids.domain.requestStillNeedsOffer
import com.riders.rider.feature.bids.domain.resolvedSubmittedAmount
import com.riders.rider.feature.offers.domain.shouldAskNotificationPermission
import com.riders.rider.feature.offers.domain.shouldPollMarketplace
import com.riders.rider.feature.offers.notification.markNotificationPermissionAsked
import com.riders.rider.feature.offers.notification.notificationPermissionWasAsked
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.needsOnboarding
import com.riders.rider.feature.wallet.domain.WALLET_TOP_UP_REQUIRED
import com.riders.rider.feature.wallet.domain.signedWalletLabel
import com.riders.rider.feature.wallet.domain.INSUFFICIENT_WALLET_CAPACITY
import com.riders.rider.feature.wallet.domain.walletBalanceIsNegative
import com.riders.rider.feature.wallet.domain.zigTopUpNotice
import java.util.Calendar

@Composable
fun HomeScreen(
    onOffers: () -> Unit,
    onActiveDeliveries: () -> Unit = onOffers,
    onWallet: () -> Unit = {},
    onDelivery: (String) -> Unit,
    onSetup: () -> Unit = {},
    inShell: Boolean = false,
    homeSelected: Boolean = true,
    onRequestOverlayVisible: (Boolean) -> Unit = {},
    profilePhoto: Bitmap? = null,
    model: HomeViewModel = hiltViewModel(),
    offersModel: OfferViewModel,
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val offersUi by offersModel.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var appResumed by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> appResumed = true
                Lifecycle.Event.ON_PAUSE -> appResumed = false
                Lifecycle.Event.ON_STOP -> {
                    appResumed = false
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) { model.onHomeShown() }
    val pollOffers = appResumed && homeSelected && (ui.onboarding == null ||
        shouldPollMarketplace(true, ui.onboarding?.availability, ui.onboarding?.receiving))
    DisposableEffect(offersModel, appResumed, homeSelected, pollOffers) {
        offersModel.setScreenResumed(appResumed && homeSelected, pollOffers)
        onDispose { offersModel.setScreenResumed(false) }
    }
    var confirmOffline by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val availability = ui.onboarding?.availability
    val availabilityNow = rememberUpdatedState(availability)
    var resumeSharing by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val resume = resumeSharing
        resumeSharing = false
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            val sharing = availabilityNow.value == "AVAILABLE" || availabilityNow.value == "BUSY"
            if (resume || sharing) {
                model.retryLocationSharing()
            } else {
                model.goOnline()
            }
        } else {
            model.locationPermissionDenied()
        }
    }
    var locationPrompted by remember { mutableStateOf(false) }
    val permissionAction = locationPermissionAction(
        granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
        asked = locationPermissionWasAsked(context),
        shouldShowRationale = context.findActivity()?.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) == true,
    )
    LaunchedEffect(availability) {
        val sharing = availability == "AVAILABLE" || availability == "BUSY"
        if (!sharing) {
            return@LaunchedEffect
        }
        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (allowed) {
            model.retryLocationSharing()
        } else if (!locationPrompted && permissionAction == LocationPermissionAction.Request) {
            locationPrompted = true
            markLocationPermissionAsked(context)
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
    var requestsOpen by rememberSaveable { mutableStateOf(false) }
    val requestPageState = rememberSaveableStateHolder()
    var unavailableRequest by remember { mutableStateOf(false) }
    var ignoredTap by remember { mutableStateOf<String?>(null) }
    val pendingRequests = rememberOfferInbox()
    val requestTap by pendingRequests.taps.collectAsStateWithLifecycle()
    var overlay by remember {
        mutableStateOf(
            RequestOverlay(
                dismissed = dismissedForSettledAttempts(
                    offersModel.ui.value.offers.map { it.deliveryId to it.searchExpiresAt },
                    offersModel.ui.value.settledIds,
                ),
            ),
        )
    }
    var sealedAttempts by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val showToast = LocalRidersToast.current
    val catalog = offersUi.offers
    val pendingTap = requestTap?.trim()?.takeIf { it.isNotEmpty() && it != ignoredTap }
    val requestClock = offersUi.nowMillis
    val previewRequest = pendingTap?.let { id ->
        cachedNotificationOffer(id, catalog, offersUi.settledIds, requestClock, ::notificationBidRequest)
    }
    val listedIds = if (ui.shift.showOffers) catalog.map { it.deliveryId } else emptyList()
    val pinnedId = overlay.openId?.trim()?.takeIf { id -> id.isNotEmpty() && catalog.any { it.deliveryId == id } }
    val eligibleIds = (listedIds + listOfNotNull(pinnedId)).distinct()
    LaunchedEffect(offersUi.settledIds, catalog) {
        val extra = dismissedForSettledAttempts(
            catalog.map { it.deliveryId to it.searchExpiresAt },
            offersUi.settledIds,
        ) - overlay.dismissed
        if (extra.isNotEmpty()) {
            overlay = overlay.copy(dismissed = overlay.dismissed + extra)
        }
    }
    LaunchedEffect(catalog, sealedAttempts) {
        val (next, remaining) = overlayAfterSearchAttempt(
            overlay,
            sealedAttempts,
            catalog.map { it.deliveryId to it.searchExpiresAt },
        )
        if (next != overlay) {
            overlay = next
        }
        if (remaining != sealedAttempts) {
            sealedAttempts = remaining
        }
    }
    val listSettled = !ui.loading && ui.readiness != null && !offersUi.loading && offersUi.requestsConfirmed && offersUi.ownBidsKnown
    val deliberateBlock = !homeSelected || requestMapAutoOpenBlocked(confirmOffline, requestsOpen) || unavailableRequest ||
        pendingTap != null || overlay.openId != null
    val homeReady = appResumed && listSettled && ui.shift.showOffers
    val autoOpenIds = if (ui.shift.showOffers) {
        autoOpenRequestIds(
            catalog.filter { requestStillNeedsOffer(it.deliveryId, offersUi.ownBids, offersUi.sentAmounts) },
            requestClock,
        )
    } else emptyList()
    LaunchedEffect(eligibleIds, overlay.openId) {
        val next = retainOpenRequest(overlay, eligibleIds)
        if (next != overlay) {
            overlay = next
        }
    }
    LaunchedEffect(homeSelected) {
        if (!homeSelected) offersModel.leaveHomeDashboard()
    }
    DisposableEffect(offersModel) {
        onDispose { offersModel.leaveHomeDashboard() }
    }
    LaunchedEffect(autoOpenIds, listSettled, homeReady, deliberateBlock, homeSelected, overlay.minimised, overlay.dismissed) {
        if (!homeSelected) return@LaunchedEffect
        // Recheck the deadline at consumption time, not just at the last recomposition.
        val liveIds = autoOpenRequestIds(catalog, offersModel.nowMillis()).toSet()
        val id = offersModel.noteVisibleRequests(
            autoOpenIds.filter { it in liveIds },
            listSettled = listSettled,
            canMaximise = homeReady && !deliberateBlock,
            suppressedIds = overlay.dismissed + overlay.minimised,
            deferMaximise = !deliberateBlock && (!listSettled || !appResumed),
        )
        if (id != null && overlay.openId == null && id !in overlay.dismissed && id !in overlay.minimised) {
            overlay = overlay.open(id)
        }
    }
    val shownRequest = catalog.firstOrNull { it.deliveryId == overlay.openId }
    val shownMatchesTap = shownRequest != null && pendingTap != null &&
        notificationBidRequest(listOf(shownRequest), pendingTap) != null
    val displayRequest = when {
        !homeSelected -> null
        pendingTap == null -> shownRequest
        shownMatchesTap -> shownRequest
        previewRequest != null -> previewRequest
        else -> null
    }
    val openingRequest = homeSelected && pendingTap != null && displayRequest == null
    SideEffect { onRequestOverlayVisible(displayRequest != null || openingRequest) }
    val currentOverlay = rememberUpdatedState(overlay)
    val currentCatalog = rememberUpdatedState(catalog)
    val currentDisplayRequest = rememberUpdatedState(displayRequest)
    val currentSealedAttempts = rememberUpdatedState(sealedAttempts)
    LaunchedEffect(offersUi.expiryDismissals) {
        val pending = offersUi.expiryDismissals
        if (pending.isEmpty()) {
            return@LaunchedEffect
        }
        val openAttempt = currentDisplayRequest.value?.let { requestAttemptIdentity(it) }
        var next = currentOverlay.value
        var sealed = currentSealedAttempts.value
        for (attempt in pending) {
            val closed = closeExpiredRequest(next, openAttempt, attempt)
            if (closed.dismissed != next.dismissed) {
                sealed = sealDismissedAttempt(sealed, attempt.substringBefore('|'), attempt.substringAfter('|', "").ifEmpty { null })
            }
            next = closed
        }
        if (next != currentOverlay.value) {
            overlay = next
        }
        if (sealed != currentSealedAttempts.value) {
            sealedAttempts = sealed
        }
        offersModel.clearExpiryDismissals(pending)
    }
    LaunchedEffect(requestTap, homeSelected) {
        if (!homeSelected) return@LaunchedEffect
        val requestId = requestTap?.trim().orEmpty()
        if (requestId.isEmpty()) {
            return@LaunchedEffect
        }
        val offer = offersModel.resolveNotificationRequest(requestId)
        if (ignoredTap == requestId) {
            if (pendingRequests.taps.value?.trim() == requestId) {
                pendingRequests.clear()
            }
            return@LaunchedEffect
        }
        if (pendingRequests.taps.value?.trim() == requestId) {
            pendingRequests.clear()
        }
        val settled = offersModel.ui.value.settledIds
        if (offer != null && !requestSettled(offer.deliveryId, offer.searchExpiresAt, settled) &&
            !requestCountdownExpired(offer.searchExpiresAt, offer.expiresAt, offersModel.nowMillis())) {
            overlay = currentOverlay.value.open(offer.deliveryId)
        } else {
            unavailableRequest = true
        }
    }
    LaunchedEffect(offersModel) {
        offersModel.requestMapEvents.collect { event ->
            val open = currentOverlay.value
            val currentDeadline = currentCatalog.value.firstOrNull { it.deliveryId == event.deliveryId }?.searchExpiresAt
            val handling = handleRequestMapSuccess(open, event, currentDeadline)
            if (handling.overlay != open) {
                overlay = handling.overlay
                sealedAttempts = sealDismissedAttempt(
                    sealedAttempts,
                    event.deliveryId,
                    event.searchDeadline,
                )
            }
            if (handling.openDeliveries) {
                offersModel.acknowledgeAccepted(event.deliveryId)
                requestsOpen = false
                onActiveDeliveries()
            }
            if (handling.showOfferSent) {
                requestsOpen = false
                val toast = offerSentToast(event.deliveryId, event.searchDeadline)
                if (toast != null) {
                    showToast(RidersToastEvent(toast.id, toast.title, toast.detail, toast.dismissMs))
                }
            }
            if (handling.openDeliveries) {
                model.refresh()
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        // Render exactly one screen. Keep the shared request state and effects above this
        // branch so minimising or resolving a request does not restart Home's refresh.
        when {
            openingRequest -> {
                RequestOpeningScreen(onClose = {
                    ignoredTap = pendingTap
                    pendingRequests.clear()
                })
                BackHandler {
                    ignoredTap = pendingTap
                    pendingRequests.clear()
                }
            }
            displayRequest != null -> {
                BackHandler {
                    if (pendingTap != null) {
                        ignoredTap = pendingTap
                        pendingRequests.clear()
                    }
                    overlay = overlay.open(displayRequest.deliveryId).minimise()
                }
                val sentAmount = resolvedSubmittedAmount(offersUi.ownBids, displayRequest.deliveryId, offersUi.sentAmounts[displayRequest.deliveryId])
                RequestMapOverlay(
                    offer = displayRequest,
                    nowMillis = requestClock,
                    accepting = offersUi.accepting,
                    submittingBid = offersUi.submittingBid,
                    submitProgress = offersUi.submitProgress,
                    statusLabel = if (sentAmount == null) offersUi.sentLabels[displayRequest.deliveryId] else null,
                    sentAmount = sentAmount,
                    bidsOpen = marketplaceBidButtonsVisible(displayRequest.serviceClass, offersUi.ownBidsKnown, offersUi.bidError ?: offersUi.bidListError),
                    error = requestMapNotice(offersUi.bidError, offersUi.error),
                    settled = requestSettled(displayRequest.deliveryId, displayRequest.searchExpiresAt, offersUi.settledIds),
                    onAccept = {
                        if (senderChoosesRider(displayRequest.serviceClass)) {
                            offersModel.offerListedPrice(displayRequest)
                        } else {
                            offersModel.accept(displayRequest)
                        }
                    },
                    onBid = { },
                    onSubmitBid = { amount -> offersModel.submitBid(displayRequest.deliveryId, amount, displayRequest.currency, displayRequest) },
                    onDecline = { offersModel.decline(displayRequest) },
                    declining = offersUi.declining,
                    onInterest = { offersModel.expressInterest(displayRequest) },
                    onClose = {
                        if (pendingTap != null) {
                            ignoredTap = pendingTap
                            pendingRequests.clear()
                        }
                        overlay = overlay.open(displayRequest.deliveryId).dismiss()
                    },
                )
            }
            requestsOpen -> {
                requestPageState.SaveableStateProvider("availableRequests") {
                    AvailableRequestsPage(
                        onOpen = { offer ->
                            if (!requestSettled(offer.deliveryId, offer.searchExpiresAt, offersUi.settledIds)) {
                                overlay = overlay.open(offer.deliveryId)
                            }
                        },
                        availability = availability,
                        receiving = ui.onboarding?.receiving,
                        model = offersModel,
                    )
                }
                BackHandler { requestsOpen = false }
            }
            else -> {
                requestPageState.SaveableStateProvider("homeDashboard") {
                    HomeDashboard(
                        ui = ui,
                        requestOffers = catalog,
                        activeRequestCount = if (offersUi.requestsConfirmed) catalog.count {
                            requestStillNeedsOffer(it.deliveryId, offersUi.ownBids, offersUi.sentAmounts)
                        } else null,
                        requestNowMillis = requestClock,
                        profilePhoto = profilePhoto,
                        greeting = ridersGreeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)),
                        onGoOnline = {
                            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                            if (allowed) {
                                model.goOnline()
                            } else if (permissionAction == LocationPermissionAction.Request) {
                                markLocationPermissionAsked(context)
                                permission.launch(locationPermissions())
                            } else {
                                openAppPermissionSettings(context)
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
                        onNewRequests = { requestsOpen = true },
                        onAcceptOffer = { offer ->
                            if (senderChoosesRider(offer.serviceClass)) {
                                offersModel.offerListedPrice(offer)
                            } else {
                                offersModel.accept(offer)
                                onActiveDeliveries()
                            }
                        },
                        onBidOffer = { },
                        onSubmitBid = { offer, amount ->
                            offersModel.submitBid(offer.deliveryId, amount, offer.currency, offer)
                        },
                        onDeclineOffer = offersModel::decline,
                        offerDeclining = offersUi.declining,
                        onInterestOffer = offersModel::expressInterest,
                        onOpenRequest = { offer ->
                            if (!requestSettled(offer.deliveryId, offer.searchExpiresAt, offersUi.settledIds)) {
                                overlay = overlay.open(offer.deliveryId)
                            }
                        },
                        settledRequests = offersUi.settledIds,
                        offerAccepting = offersUi.accepting,
                        offerSubmitting = offersUi.submittingBid,
                        offerSubmitProgress = offersUi.submitProgress,
                        offerBidError = offersUi.bidError,
                        offerListError = offersUi.bidListError,
                        offerBidsKnown = offersUi.ownBidsKnown,
                        offerStatus = offersUi.sentLabels,
                        offerAmounts = offersUi.sentAmounts,
                        offerBids = offersUi.ownBids,
                        onWallet = onWallet,
                        onDelivery = onDelivery,
                        onRefresh = {
                            model.pullRefresh()
                            if (pollOffers) offersModel.pullRefresh()
                        },
                        permissionAction = permissionAction,
                        onAllowLocation = {
                            if (permissionAction == LocationPermissionAction.Request) {
                                resumeSharing = true
                                markLocationPermissionAsked(context)
                                permission.launch(locationPermissions())
                            }
                        },
                        onOpenPermissionSettings = { openAppPermissionSettings(context) },
                        onEnableLocation = { openLocationSettings(context) },
                        onRestartSharing = model::restartLocationSharing,
                        onSetup = onSetup,
                        includeNavigationBars = !inShell,
                        inShell = inShell,
                    )
                }
            }
        }
    if (unavailableRequest) {
        RidersDialog(visible = true, onDismiss = { unavailableRequest = false }) {
            RidersDialogTitle(REQUEST_UNAVAILABLE)
            RidersDialogBody("This request has expired or is no longer available.")
            RidersDialogActions {
                RidersPrimaryButton(
                    label = "OK",
                    onClick = { unavailableRequest = false },
                    compact = true,
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                )
            }
        }
    }
    if (confirmOffline) {
        RidersDialog(visible = true, onDismiss = { confirmOffline = false }) {
            RidersDialogTitle(OFFLINE_WITH_DELIVERIES_TITLE)
            RidersDialogBody(OFFLINE_WITH_DELIVERIES_MESSAGE)
            RidersDialogActions {
                RidersSecondaryButton(
                    label = "Stay online",
                    onClick = { confirmOffline = false },
                    bordered = false,
                    compact = true,
                    containerColor = Color(0xFFF1F3F4),
                    contentColor = Color(0xFF374151),
                    modifier = Modifier.weight(1f).height(44.dp),
                )
                RidersPrimaryButton(
                    label = "Go offline",
                    onClick = {
                        confirmOffline = false
                        model.goOffline()
                    },
                    compact = true,
                    modifier = Modifier.weight(1f).height(44.dp),
                )
            }
        }
    }
    }
}

@Composable
private fun LocationSharingPausedNotice(
    notice: LocationNotice,
    permissionAction: LocationPermissionAction,
    restarting: Boolean,
    onAllowLocation: () -> Unit,
    onOpenPermissionSettings: () -> Unit,
    onEnableLocation: () -> Unit,
    onRestartSharing: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (notice == LocationNotice.WaitingForFix) {
        return
    }
    val permissionSettings = notice == LocationNotice.PermissionMissing && permissionAction == LocationPermissionAction.Settings
    val title = when (notice) {
        LocationNotice.PermissionMissing -> "Location permission required"
        LocationNotice.LocationDisabled -> "Location is turned off"
        LocationNotice.WaitingForFix -> "Getting your location"
        LocationNotice.FixUnavailable -> "Location unavailable"
        LocationNotice.NoInternet -> "No internet connection"
        LocationNotice.UploadPending -> "Unable to update location"
        LocationNotice.ServiceStopped -> "Location sharing stopped"
    }
    val message = when (notice) {
        LocationNotice.PermissionMissing -> if (permissionSettings) {
            "Enable location permission in your phone settings."
        } else {
            "Allow location access to continue receiving requests."
        }
        LocationNotice.LocationDisabled -> "Turn on your device's location to continue."
        LocationNotice.WaitingForFix -> "This may take a moment. Move to an open area if needed."
        LocationNotice.FixUnavailable -> "Check that location is enabled and try moving to an open area."
        LocationNotice.NoInternet -> "Check your connection and try again."
        LocationNotice.UploadPending -> "Waiting to reconnect. Location sharing will resume automatically."
        LocationNotice.ServiceStopped -> "Restart location sharing to continue receiving requests."
    }
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.dangerSurface)
            .padding(RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Text(title, style = RidersType.bodyStrong, color = RidersColors.text)
        Text(message, style = RidersType.caption, color = RidersColors.textSecondary)
        when (notice) {
            LocationNotice.PermissionMissing -> RidersSecondaryButton(
                label = if (permissionSettings) "Open settings" else "Allow location",
                onClick = if (permissionSettings) onOpenPermissionSettings else onAllowLocation,
                compact = true,
            )
            LocationNotice.LocationDisabled -> RidersSecondaryButton(
                label = "Enable location",
                onClick = onEnableLocation,
                compact = true,
            )
            LocationNotice.ServiceStopped -> RidersSecondaryButton(
                label = "Restart sharing",
                onClick = onRestartSharing,
                compact = true,
                loading = restarting,
                loadingLabel = "Restarting",
            )
            LocationNotice.WaitingForFix,
            LocationNotice.FixUnavailable,
            LocationNotice.NoInternet,
            LocationNotice.UploadPending,
            -> Unit
        }
    }
}

@Composable
private fun RequestOpeningScreen(onClose: () -> Unit) {
    val density = LocalDensity.current
    Box(Modifier.fillMaxSize().background(RidersColors.background)) {
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(
                    top = with(density) { WindowInsets.statusBars.getTop(this).toDp() } + RidersSpacing.md,
                    end = RidersSpacing.lg,
                )
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button, onClick = onClose),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_close),
                contentDescription = "Close request",
                tint = RidersColors.text,
                modifier = Modifier.size(20.dp),
            )
        }
        RidersLoadingState(
            "Opening request",
            Modifier.align(Alignment.Center),
        )
    }
}

@Composable
fun HomeDashboard(
    ui: HomeUi,
    requestOffers: List<OfferResponse> = emptyList(),
    activeRequestCount: Int? = null,
    requestNowMillis: Long = 0L,
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
    onDeclineOffer: (OfferResponse) -> Unit = {},
    offerDeclining: Boolean = false,
    onInterestOffer: (OfferResponse) -> Unit = {},
    onOpenRequest: (OfferResponse) -> Unit = {},
    offerAccepting: Boolean = false,
    offerSubmitting: Boolean = false,
    offerSubmitProgress: OfferActionProgress? = null,
    offerBidError: String? = null,
    offerListError: String? = null,
    offerBidsKnown: Boolean = false,
    offerStatus: Map<String, String> = emptyMap(),
    offerAmounts: Map<String, String> = emptyMap(),
    offerBids: List<OwnBid> = emptyList(),
    settledRequests: Set<String> = emptySet(),
    onDelivery: (String) -> Unit = { _ -> },
    onRefresh: () -> Unit = {},
    permissionAction: LocationPermissionAction = LocationPermissionAction.Request,
    onAllowLocation: () -> Unit = {},
    onOpenPermissionSettings: () -> Unit = {},
    onEnableLocation: () -> Unit = {},
    onRestartSharing: () -> Unit = {},
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
        val accountMessage = ui.error ?: "Your account could not be loaded. Check your connection and try again."
        val accountTransport = readiness == null && !ui.loading && isConnectionFailure(accountMessage)
        val networkStatus = rememberNetworkStatus(
            transportFailure = ui.connectionFailure || accountTransport,
            backendFailure = ui.backendFailure,
        )
        val statusTop = with(LocalDensity.current) { WindowInsets.statusBars.getTop(this).toDp() }
        val topInset = if (inShell) 0.dp else statusTop
        val headerHeight = topInset + 200.dp
        RidersPullRefresh(
            refreshing = ui.refreshing && readiness != null,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
        if (readiness == null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .then(if (includeNavigationBars) Modifier.navigationBarsPadding() else Modifier),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(headerHeight)
                        .clipToBounds(),
                ) {
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
                }
                Column(Modifier.fillMaxSize()) {
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
                    RidersCenteredContent(
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(horizontal = horizontal),
                    ) {
                        if (
                            ui.loading ||
                            networkWarningPending(networkStatus, accountTransport) ||
                            (accountTransport && ui.networkRecoveryOutstanding && networkStatus != NetworkAvailability.Disconnected)
                        ) {
                            RidersLoadingState("Checking your account")
                        } else {
                            RidersFailureNotice(
                                message = accountMessage,
                                title = accountLoadFailureTitle(ui.error),
                                onRetry = onRefresh,
                            )
                        }
                    }
                }
            }
        } else Column(
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
                        AvailabilityCard(
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
                    if (readiness != null) {
                        HomeSummaries(
                            balance = ui.walletBalance,
                            currency = ui.walletCurrency,
                            insufficient = ui.walletInsufficient,
                            usdDebtBalance = ui.usdDebtBalance,
                            restricted = ui.walletRestricted,
                            activeCount = ui.activeDeliveryTotal,
                            newRequestCount = activeRequestCount,
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
                    val locationNotice = ui.locationNotice?.takeUnless { it == LocationNotice.WaitingForFix }
                    if (locationNotice != null) {
                        LocationSharingPausedNotice(
                            notice = locationNotice,
                            permissionAction = permissionAction,
                            restarting = ui.restartingLocation,
                            onAllowLocation = onAllowLocation,
                            onOpenPermissionSettings = onOpenPermissionSettings,
                            onEnableLocation = onEnableLocation,
                            onRestartSharing = onRestartSharing,
                            modifier = Modifier.padding(horizontal = horizontal),
                        )
                    }
                    val recoveryText = if (ui.shift.recoveryFailed) {
                        ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again."
                    } else {
                        null
                    }
                    val failureText = ui.error ?: recoveryText
                    when (
                        homeConnectionWarning(
                            availability = networkStatus,
                            connectionFailure = ui.connectionFailure,
                            backendFailure = ui.backendFailure,
                            recoveryOutstanding = ui.networkRecoveryOutstanding,
                            messageLooksLikeConnectionFailure = isConnectionFailure(failureText),
                        )
                    ) {
                        HomeConnectionWarning.Snackbar -> RidersNetworkNotice(
                            onRetry = onRefresh,
                            modifier = Modifier.padding(horizontal = horizontal),
                        )
                        HomeConnectionWarning.Message -> if (failureText != null) {
                            RidersErrorState(message = failureText, modifier = Modifier.padding(horizontal = horizontal))
                        }
                        HomeConnectionWarning.Hidden -> Unit
                    }
                    if (!ui.assignmentsUnknown) {
                        RequestsSection(
                            ui,
                            requestOffers,
                            requestNowMillis,
                            onNewRequests,
                            onAcceptOffer,
                            onBidOffer,
                            onSubmitBid,
                            onDeclineOffer,
                            offerDeclining,
                            onInterestOffer,
                            onOpenRequest,
                            offerAccepting,
                            offerSubmitting,
                            offerSubmitProgress,
                            offerBidError,
                            offerListError,
                            offerBidsKnown,
                            offerStatus,
                            offerAmounts,
                            offerBids,
                            settledRequests,
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
            .clip(CircleShape)
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
    insufficient: Boolean,
    usdDebtBalance: String?,
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
        if (insufficient) {
            Text(
                INSUFFICIENT_WALLET_CAPACITY,
                style = RidersType.caption,
                color = RidersColors.error,
            )
        } else if (currency.equals("ZWG", ignoreCase = true) && usdDebtBalance != null) {
            Text(
                "USD debt ${signedWalletLabel("USD", usdDebtBalance)}",
                style = RidersType.caption,
                color = RidersColors.error,
            )
            Text(
                zigTopUpNotice(usdDebtBalance),
                style = RidersType.caption,
                color = RidersColors.error,
            )
        } else if (restricted) {
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
                    enabled = goOnlineEnabled(loading, changingAvailability),
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
                    enabled = goOnlineEnabled(loading, changingAvailability),
                    loading = goingOffline,
                    loadingLabel = "Going offline…",
                    icon = R.drawable.ic_power,
                    bordered = false,
                    compact = true,
                    containerColor = RidersColors.surface,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                )
            }
        }
    }
}

@Composable
private fun RequestsSection(
    ui: HomeUi,
    requestOffers: List<OfferResponse>,
    requestNowMillis: Long,
    onOffers: () -> Unit,
    onAcceptOffer: (OfferResponse) -> Unit,
    onBidOffer: (OfferResponse) -> Unit,
    onSubmitBid: (OfferResponse, String) -> Unit,
    onDeclineOffer: (OfferResponse) -> Unit,
    offerDeclining: Boolean,
    onInterestOffer: (OfferResponse) -> Unit,
    onOpenRequest: (OfferResponse) -> Unit,
    offerAccepting: Boolean,
    offerSubmitting: Boolean,
    offerSubmitProgress: OfferActionProgress?,
    offerBidError: String?,
    offerListError: String?,
    offerBidsKnown: Boolean,
    offerStatus: Map<String, String>,
    offerAmounts: Map<String, String>,
    offerBids: List<OwnBid>,
    settledRequests: Set<String>,
    horizontal: Dp,
    contentBottom: Float,
) {
    val shown = requestOffers
        .filter { requestStillNeedsOffer(it.deliveryId, offerBids, offerAmounts) }
        .take(2)
    val hasRequests = ui.shift.showOffers && shown.isNotEmpty()
    val nowMillis = requestNowMillis.takeIf { it > 0L } ?: System.currentTimeMillis()
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
                    submitProgress = offerSubmitProgress,
                    statusLabel = if (sentAmount == null) offerStatus[offer.deliveryId] else null,
                    sentAmount = sentAmount,
                    bidsOpen = marketplaceBidButtonsVisible(offer.serviceClass, offerBidsKnown, offerBidError ?: offerListError),
                    onAccept = { onAcceptOffer(offer) },
                    onBid = { onBidOffer(offer) },
                    onSubmitBid = { amount -> onSubmitBid(offer, amount) },
                    onDecline = { onDeclineOffer(offer) },
                    declining = offerDeclining,
                    submitError = offerBidError,
                    onInterest = { onInterestOffer(offer) },
                    settled = requestSettled(offer.deliveryId, offer.searchExpiresAt, settledRequests),
                    onOpen = if (requestSettled(offer.deliveryId, offer.searchExpiresAt, settledRequests)) null else {
                        { onOpenRequest(offer) }
                    },
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
    val remaining = if (top > 0f) (contentBottom - top).coerceAtLeast(0f) else 0f
    Box(
        Modifier
            .fillMaxWidth()
            .onGloballyPositioned { top = it.positionInRoot().y }
            .then(if (remaining > 0f) Modifier.heightIn(min = with(density) { remaining.toDp() }) else Modifier)
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
        contentAlignment = Alignment.Center,
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
        content()
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

private const val LOCATION_PERMISSION_PREFS = "rider_location_permission"
private const val LOCATION_PERMISSION_ASKED = "asked"

private fun locationPermissionWasAsked(context: Context): Boolean {
    return context.getSharedPreferences(LOCATION_PERMISSION_PREFS, Context.MODE_PRIVATE)
        .getBoolean(LOCATION_PERMISSION_ASKED, false)
}

private fun markLocationPermissionAsked(context: Context) {
    context.getSharedPreferences(LOCATION_PERMISSION_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(LOCATION_PERMISSION_ASKED, true)
        .apply()
}

private fun Context.findActivity(): Activity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is Activity) {
            return current
        }
        current = current.baseContext
    }
    return null
}

private fun openAppPermissionSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}

private fun openLocationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}

private fun sampleDelivery() = ActiveDelivery(
    deliveryId = "delivery-1",
    assignmentId = "assignment-1",
    status = "ASSIGNED",
    parcelDescription = "Documents",
    pickupAddress = "Samora Machel Avenue, Harare",
    dropoffAddress = "Borrowdale Road, Harare",
)
