package com.riders.rider.feature.offers.presentation

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import com.riders.rider.R
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogActions
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTextButton
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersDialogTone
import com.riders.rider.core.design.acceptPressEnabled
import com.riders.rider.core.design.RidersCenteredContent
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.displayedBidProblem
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.newMarketplaceOffers
import com.riders.rider.feature.bids.domain.formatBidDollars
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.DeliveryStop
import com.riders.rider.feature.delivery.presentation.ServiceClassLabel
import com.riders.rider.feature.delivery.presentation.cardLocationPinHeight
import com.riders.rider.feature.delivery.presentation.cardLocationPinWidth
import com.riders.rider.feature.delivery.presentation.deliveryContentMatches
import com.riders.rider.feature.delivery.presentation.filteredContentTitle
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.offerDistanceLabel
import com.riders.rider.feature.offers.domain.CustomOfferDialogState
import com.riders.rider.feature.offers.domain.CustomOfferPhase
import com.riders.rider.feature.offers.domain.DECLINE_REQUEST
import com.riders.rider.feature.offers.domain.OFFER_YOUR_PRICE
import com.riders.rider.feature.offers.domain.beginCustomOfferSubmit
import com.riders.rider.feature.offers.domain.customOfferButtonLabel
import com.riders.rider.feature.offers.domain.dismissCustomOfferDialog
import com.riders.rider.feature.offers.domain.editCustomOfferAmount
import com.riders.rider.feature.offers.domain.observeCustomOfferSubmit
import com.riders.rider.feature.offers.domain.openCustomOfferDialog
import com.riders.rider.feature.bids.domain.resolvedSubmittedAmount
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.senderChoosesRider
import com.riders.rider.feature.offers.domain.requestAmountLabel
import com.riders.rider.feature.offers.domain.shouldPollMarketplace
import com.riders.rider.feature.offers.domain.requestCurrencyLabel
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.sortDeliveries
import com.riders.rider.feature.offers.domain.offerStopLine
import kotlinx.coroutines.delay

@Composable
fun OffersScreen(
    inShell: Boolean = false,
    availability: String? = null,
    receiving: Boolean? = null,
    modifier: Modifier = Modifier,
    contentKind: String? = null,
    sort: DeliveryListSort = DeliveryListSort.Newest,
    unbidOnly: Boolean = false,
    browseOnOpen: (OfferResponse) -> Unit,
    model: OfferViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var confirmAccept by remember { mutableStateOf<OfferResponse?>(null) }
    var confirmDecline by remember { mutableStateOf<OfferResponse?>(null) }
    var actingDeliveryId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(ui.accepting, ui.submittingBid, ui.declining) {
        if (!ui.accepting && !ui.submittingBid && !ui.declining) {
            actingDeliveryId = null
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> model.setScreenResumed(true)
                Lifecycle.Event.ON_PAUSE -> model.setScreenResumed(false)
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            model.setScreenResumed(true)
        }
        onDispose {
            lifecycle.removeObserver(observer)
            model.setScreenResumed(false)
        }
    }
    val requestsEnabled = shouldPollMarketplace(appVisible = true, availability, receiving)
    LaunchedEffect(requestsEnabled) {
        model.setRequestsEnabled(requestsEnabled)
    }
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = model::pullRefresh,
        modifier = modifier
            .fillMaxSize()
            .background(RidersColors.sheet)
            .then(if (inShell) Modifier else Modifier.statusBarsPadding())
            .then(if (inShell) Modifier else Modifier.navigationBarsPadding()),
    ) {
    val centeredList = offerListFillsPage(ui, contentKind, sort, unbidOnly)
    if (centeredList) {
        RidersCenteredContent(
            Modifier
                .fillMaxSize()
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.lg),
        ) {
            OfferList(
                ui,
                onAccept = { confirmAccept = it },
                onBid = model::openBid,
                onSubmitBid = { offer, amount -> model.submitBid(offer.deliveryId, amount, offer.currency) },
                onDecline = { confirmDecline = it },
                actingDeliveryId = actingDeliveryId,
                declining = ui.declining,
                onInterest = model::expressInterest,
                onRetry = model::pullRefresh,
                deferLoading = true,
                contentKind = contentKind,
                sort = sort,
                unbidOnly = unbidOnly,
                onOpen = browseOnOpen,
            )
        }
    } else Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        OfferList(
            ui,
            onAccept = { confirmAccept = it },
            onBid = model::openBid,
            onSubmitBid = { offer, amount -> model.submitBid(offer.deliveryId, amount, offer.currency) },
            onDecline = { confirmDecline = it },
            actingDeliveryId = actingDeliveryId,
            declining = ui.declining,
            onInterest = model::expressInterest,
            onRetry = model::pullRefresh,
            deferLoading = true,
            contentKind = contentKind,
            sort = sort,
            unbidOnly = unbidOnly,
            onOpen = browseOnOpen,
        )
    }
    }
    val pendingAccept = confirmAccept
    val listedPrice = pendingAccept != null && senderChoosesRider(pendingAccept.serviceClass)
    RidersDialog(visible = pendingAccept != null, onDismiss = { confirmAccept = null }) {
        RidersDialogTitle(if (listedPrice) "Send offer?" else "Accept offer?")
        RidersDialogBody(
            if (listedPrice) "Send this offer to the customer?" else "Are you sure you want to accept this delivery?",
        )
        RidersDialogActions {
            RidersDialogTextButton(
                label = "Not yet",
                tone = RidersDialogTone.Neutral,
                onClick = { confirmAccept = null },
            )
            RidersDialogTextButton(
                label = if (listedPrice) "Send offer" else "Accept",
                onClick = {
                    val offer = pendingAccept ?: return@RidersDialogTextButton
                    confirmAccept = null
                    if (ui.accepting || ui.submittingBid || ui.declining) {
                        return@RidersDialogTextButton
                    }
                    actingDeliveryId = offer.deliveryId
                    respondToOffer(model, offer)
                },
            )
        }
    }
    val pendingDecline = confirmDecline
    RidersDialog(visible = pendingDecline != null, onDismiss = { confirmDecline = null }) {
        RidersDialogTitle("Decline offer?")
        RidersDialogBody("This delivery request will be removed from your offers.")
        RidersDialogActions {
            RidersDialogTextButton(
                label = "Keep offer",
                tone = RidersDialogTone.Neutral,
                onClick = { confirmDecline = null },
            )
            RidersDialogTextButton(
                label = "Decline",
                onClick = {
                    val offer = pendingDecline ?: return@RidersDialogTextButton
                    confirmDecline = null
                    if (ui.declining || ui.accepting || ui.submittingBid) {
                        return@RidersDialogTextButton
                    }
                    actingDeliveryId = offer.deliveryId
                    model.decline(offer.deliveryId)
                },
            )
        }
    }
}

private fun offerListFillsPage(
    ui: OfferUi,
    contentKind: String?,
    sort: DeliveryListSort,
    unbidOnly: Boolean,
): Boolean {
    val pool = if (unbidOnly) newMarketplaceOffers(ui.offers, ui.ownBids, ui.sentAmounts) else ui.offers
    if (ui.loading && pool.isEmpty()) {
        return true
    }
    if (pool.isEmpty() && ui.error != null) {
        return true
    }
    val shown = sortDeliveries(
        pool.filter { deliveryContentMatches(it.parcel.description, contentKind) },
        sort,
        { it.expiresAt },
        { it.distanceMeters },
        { it.offeredPrice },
        { it.deliveryId },
    )
    return shown.isEmpty()
}

@Composable
private fun OfferList(
    ui: OfferUi,
    onAccept: (OfferResponse) -> Unit,
    onBid: (OfferResponse) -> Unit,
    onSubmitBid: (OfferResponse, String) -> Unit,
    onDecline: (OfferResponse) -> Unit,
    declining: Boolean,
    actingDeliveryId: String? = null,
    onInterest: (OfferResponse) -> Unit,
    onRetry: () -> Unit,
    deferLoading: Boolean = false,
    contentKind: String? = null,
    sort: DeliveryListSort = DeliveryListSort.Newest,
    unbidOnly: Boolean = false,
    onOpen: ((OfferResponse) -> Unit)? = null,
) {
    val pool = if (unbidOnly) newMarketplaceOffers(ui.offers, ui.ownBids, ui.sentAmounts) else ui.offers
    val shown = sortDeliveries(
        pool.filter { deliveryContentMatches(it.parcel.description, contentKind) },
        sort,
        { it.expiresAt },
        { it.distanceMeters },
        { it.offeredPrice },
        { it.deliveryId },
    )
    val emptyTitle = if (unbidOnly) "No new offers" else "No open requests"
    val emptyBody = if (unbidOnly) {
        "Available delivery requests will appear here."
    } else {
        "New requests appear here while you stay available."
    }
    when {
        ui.loading && pool.isEmpty() -> RidersLoadingState("Looking for requests")
        pool.isEmpty() && ui.error != null -> RidersFailureNotice(
            message = ui.error,
            title = "Requests unavailable",
            onRetry = onRetry,
        )
        shown.isEmpty() -> RidersEmptyState(
            title = filteredContentTitle(contentKind, emptyTitle),
            body = emptyBody,
            image = R.drawable.parcel_box,
        )
        else -> shown.forEach { offer ->
            val sentAmount = resolvedSubmittedAmount(ui.ownBids, offer.deliveryId, ui.sentAmounts[offer.deliveryId])
            val openRequest = onOpen?.let { open -> { open(offer) } }
            OfferRequestCard(
                offer,
                ui.nowMillis,
                accepting = ui.accepting,
                statusLabel = if (sentAmount == null) ui.sentLabels[offer.deliveryId] else null,
                sentAmount = sentAmount,
                submittingBid = ui.submittingBid,
                bidsOpen = marketplaceBidButtonsVisible(offer.serviceClass, ui.ownBidsKnown, ui.bidError ?: ui.bidListError),
                onAccept = { if (openRequest != null) openRequest() else onAccept(offer) },
                onBid = { if (openRequest != null) openRequest() else onBid(offer) },
                onSubmitBid = { amount -> if (openRequest != null) openRequest() else onSubmitBid(offer, amount) },
                onDecline = { if (openRequest != null) openRequest() else onDecline(offer) },
                declining = declining && (actingDeliveryId == null || actingDeliveryId == offer.deliveryId),
                actingDeliveryId = actingDeliveryId,
                deferLoading = deferLoading,
                submitError = ui.bidError,
                onInterest = { if (openRequest != null) openRequest() else onInterest(offer) },
                onOpen = openRequest,
                fresh = true,
            )
        }
    }
    val bidProblem = displayedBidProblem(
        hasMarketplaceRequest = ui.offers.any { it.serviceClass == "EXPRESS" || it.serviceClass == "FLEXIBLE" },
        listProblem = ui.bidListError,
        submitProblem = ui.bidError,
    )
    if (bidProblem != null && ui.offers.isNotEmpty()) {
        RidersFailureNotice(message = bidProblem)
    }
    if (ui.error != null && ui.offers.isNotEmpty()) {
        RidersFailureNotice(message = ui.error, onRetry = onRetry)
    }
}


@Composable
private fun IncomingOfferActions(
    offer: OfferResponse,
    canAct: Boolean,
    accepting: Boolean,
    submittingBid: Boolean,
    onAccept: () -> Unit,
    onSubmitBid: (String) -> Unit,
    onDecline: () -> Unit,
    declining: Boolean,
    submitError: String? = null,
    mapDecline: Boolean = false,
) {
    var dialog by remember(offer.deliveryId) { mutableStateOf(CustomOfferDialogState(amount = offer.offeredPrice)) }
    var confirmAccept by remember(offer.deliveryId) { mutableStateOf(false) }
    var confirmDecline by remember(offer.deliveryId) { mutableStateOf(false) }
    val cents = bidAmountCents(dialog.amount)
    val sending = dialog.phase != CustomOfferPhase.Idle || submittingBid
    val priceError = if (dialog.amount.isNotBlank() && cents == null) "Enter a price." else null
    val listedPrice = senderChoosesRider(offer.serviceClass)
    val busy = accepting || submittingBid || declining
    LaunchedEffect(dialog.phase, submittingBid, submitError) {
        val next = observeCustomOfferSubmit(dialog, submittingBid, submitError)
        if (next != dialog) {
            dialog = next
        }
    }
    RidersDialog(
        visible = dialog.open,
        onDismiss = {
            if (submittingBid || dialog.phase == CustomOfferPhase.InFlight) {
                return@RidersDialog
            }
            dialog = dismissCustomOfferDialog(dialog)
        },
    ) {
        RidersDialogTitle("Your offer")
        RidersTextField(
            label = "Your offer (${requestCurrencyLabel(offer.currency)})",
            value = dialog.amount,
            onValueChange = { dialog = editCustomOfferAmount(dialog, it) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            error = priceError ?: if (dialog.phase == CustomOfferPhase.Idle) dialog.error else null,
        )
        YourOfferDialogButtons(
            confirmLabel = customOfferButtonLabel(sending),
            loading = sending,
            confirmEnabled = canAct && cents != null && !accepting && !sending,
            dismissEnabled = !sending,
            onConfirm = {
                val parsed = bidAmountCents(dialog.amount) ?: return@YourOfferDialogButtons
                val started = beginCustomOfferSubmit(dialog, submitError) ?: return@YourOfferDialogButtons
                dialog = started
                onSubmitBid(formatBidDollars(parsed))
            },
            onDismiss = { dialog = dismissCustomOfferDialog(dialog) },
        )
    }
    if (mapDecline) {
        RidersDialog(visible = confirmAccept, onDismiss = { if (!busy) confirmAccept = false }) {
            RidersDialogTitle(if (listedPrice) "Send offer?" else "Accept offer?")
            RidersDialogBody(
                if (listedPrice) "Send this offer to the customer?" else "Are you sure you want to accept this delivery?",
            )
            MapOfferDialogButtons(
                confirmLabel = if (listedPrice) "Send offer" else "Accept",
                dismissLabel = "Cancel",
                onConfirm = {
                    if (busy) {
                        return@MapOfferDialogButtons
                    }
                    confirmAccept = false
                    onAccept()
                },
                onDismiss = { confirmAccept = false },
                confirmEnabled = canAct && !busy,
                dismissEnabled = !busy,
            )
        }
        RidersDialog(visible = confirmDecline, onDismiss = { if (!declining) confirmDecline = false }) {
            RidersDialogTitle("Decline offer?")
            RidersDialogBody("This delivery request will be removed from your offers.")
            MapOfferDialogButtons(
                confirmLabel = "Decline",
                dismissLabel = "Keep offer",
                confirmTone = RidersDialogTone.Danger,
                onConfirm = {
                    if (busy) {
                        return@MapOfferDialogButtons
                    }
                    confirmDecline = false
                    onDecline()
                },
                onDismiss = { confirmDecline = false },
                confirmEnabled = canAct && !busy,
                dismissEnabled = !declining,
            )
        }
    }
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        RidersPrimaryButton(
            label = "Accept",
            onClick = { if (mapDecline) confirmAccept = true else onAccept() },
            enabled = canAct && !submittingBid,
            loading = accepting || submittingBid,
            loadingLabel = if (senderChoosesRider(offer.serviceClass)) "Sending" else "Accepting",
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = RidersSpacing.sm),
            compact = true,
        )
        RidersSecondaryButton(
            label = OFFER_YOUR_PRICE,
            onClick = { dialog = openCustomOfferDialog(offer.offeredPrice) },
            enabled = canAct && !accepting && !submittingBid,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
            compact = true,
        )
        RidersSecondaryButton(
            label = DECLINE_REQUEST,
            loadingLabel = "Declining",
            loading = declining,
            enabled = canAct && !accepting && !submittingBid,
            onClick = { if (mapDecline) confirmDecline = true else onDecline() },
            bordered = false,
            compact = true,
            containerColor = RidersColors.dangerSurface,
            contentColor = RidersColors.destructive,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = RidersSpacing.sm),
        )
    }
}

@Composable
private fun YourOfferDialogButtons(
    confirmLabel: String,
    loading: Boolean,
    confirmEnabled: Boolean,
    dismissEnabled: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = RidersSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RidersSecondaryButton(
            label = "Cancel",
            onClick = onDismiss,
            enabled = dismissEnabled,
            bordered = false,
            containerColor = RidersColors.card,
            contentColor = RidersColors.text,
            regular = true,
            modifier = Modifier.weight(1f),
        )
        RidersPrimaryButton(
            label = confirmLabel,
            onClick = onConfirm,
            enabled = confirmEnabled,
            loading = loading,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun MapOfferDialogButtons(
    confirmLabel: String,
    dismissLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    confirmEnabled: Boolean,
    dismissEnabled: Boolean,
    confirmTone: RidersDialogTone = RidersDialogTone.Primary,
    confirmLoading: Boolean = false,
) {
    Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RidersDialogTextButton(
                label = dismissLabel,
                onClick = onDismiss,
                tone = RidersDialogTone.Neutral,
                enabled = dismissEnabled,
                modifier = Modifier.weight(1f),
            )
            if (confirmTone == RidersDialogTone.Danger) {
                RidersSecondaryButton(
                    label = confirmLabel,
                    onClick = onConfirm,
                    enabled = confirmEnabled,
                    loading = confirmLoading,
                    bordered = false,
                    compact = true,
                    containerColor = Color(0xFFB42318),
                    contentColor = RidersColors.textInverse,
                    modifier = Modifier.weight(1f),
                )
            } else {
                RidersPrimaryButton(
                    label = confirmLabel,
                    onClick = onConfirm,
                    enabled = confirmEnabled,
                    loading = confirmLoading,
                    compact = true,
                    modifier = Modifier.weight(1f),
                )
            }
        }
}

@Composable
private fun SentOfferCard(offer: OfferResponse, amount: String) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        SentOfferHeading()
        SentOfferNote(offer, amount)
        Spacer(Modifier.height(RidersSpacing.md))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Your offer", style = RidersType.body, color = RidersColors.textSecondary)
            Text(
                requestAmountLabel(offer.currency, amount),
                style = RidersType.bodyStrong,
                color = RidersColors.text,
            )
        }
    }
}



@Composable
private fun SentOfferHeading() {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(RidersColors.primaryLight),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_check),
                contentDescription = "Offer sent",
                modifier = Modifier.size(20.dp),
                tint = RidersColors.primary,
            )
        }
    }
}

@Composable
private fun SentOfferNote(offer: OfferResponse, amount: String) {
    Text(
        offerSentConfirmation(offer.currency, amount),
        style = RidersType.body,
        color = RidersColors.textSecondary,
    )
}


private fun respondToOffer(model: OfferViewModel, offer: OfferResponse) {
    if (senderChoosesRider(offer.serviceClass)) {
        model.offerListedPrice(offer)
    } else {
        model.accept(offer)
    }
}

@Composable
fun OfferRequestCard(
    offer: OfferResponse,
    nowMillis: Long,
    accepting: Boolean = false,
    submittingBid: Boolean = false,
    statusLabel: String? = null,
    sentAmount: String? = null,
    bidsOpen: Boolean = true,
    onAccept: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onBid: () -> Unit,
    onSubmitBid: (String) -> Unit = {},
    onDecline: () -> Unit = {},
    declining: Boolean = false,
    actingDeliveryId: String? = null,
    deferLoading: Boolean = false,
    submitError: String? = null,
    @Suppress("UNUSED_PARAMETER") onInterest: () -> Unit = {},
    onOpen: (() -> Unit)? = null,
    fresh: Boolean = false,
    settled: Boolean = false,
    mapDecline: Boolean = false,
) {
    if (sentAmount != null) {
        SentOfferCard(offer, sentAmount)
        return
    }
    var awaiting by remember(offer.deliveryId, offer.searchExpiresAt, offer.expiresAt) { mutableStateOf(false) }
    val tracked = deferLoading
    LaunchedEffect(accepting, submittingBid) {
        if (!accepting && !submittingBid) {
            awaiting = false
        }
    }
    val tickingNow = rememberOfferCountdownNow(offer.deliveryId, offer.searchExpiresAt, offer.expiresAt, nowMillis)
    val canAct = bidsOpen && acceptPressEnabled(
        !requestCountdownExpired(offer.searchExpiresAt, offer.expiresAt, tickingNow),
        confirmed = false,
    ) && !accepting && !submittingBid
    RidersCard(modifier = Modifier.fillMaxWidth(), onClick = if (settled) null else onOpen, bordered = false, bottomPadding = RidersSpacing.xs) {
        OfferSummary(offer, tickingNow, detailed = false, statusLabel = statusLabel, fresh = fresh)
        if (!settled && (bidsOpen || !senderChoosesRider(offer.serviceClass))) {
            if (offer.serviceClass == "EXPRESS" && statusLabel != null) {
                Text(statusLabel, style = RidersType.body, color = RidersColors.textSecondary)
            } else if (statusLabel == null) {
                IncomingOfferActions(
                    offer = offer,
                    canAct = canAct,
                    accepting = if (tracked) actingDeliveryId == offer.deliveryId && accepting else awaiting && accepting,
                    submittingBid = if (tracked) actingDeliveryId == offer.deliveryId && submittingBid else awaiting && submittingBid,
                    onAccept = {
                        if (!tracked) {
                            awaiting = true
                        }
                        onAccept()
                    },
                    onSubmitBid = { amount ->
                        awaiting = true
                        onSubmitBid(amount)
                    },
                    onDecline = onDecline,
                    declining = declining,
                    submitError = submitError,
                    mapDecline = mapDecline,
                )
            }
        }
    }
}

@Composable
private fun OfferSummary(offer: OfferResponse, nowMillis: Long, detailed: Boolean, statusLabel: String? = null, fresh: Boolean = false) {
    val hasDeadline = offer.expiresAt.isNotBlank()
    val expired = hasDeadline && offerIsExpired(offer.expiresAt, nowMillis)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ContentIcon(offer.parcel.description, size = 14.dp, muted = true)
            ContentLabel(offer.parcel.description, compact = true)
            ServiceClassLabel(offer.serviceClass)
        }
        if (hasDeadline || statusLabel != null) {
            OfferExpiry(offer.expiresAt, offer.searchExpiresAt, nowMillis, expired, statusLabel, fresh)
        }
    }
    Column(Modifier.fillMaxWidth()) {
        OfferStop(offerStopLine(offer.pickup.address, offer.pickup.landmark), pickup = true, connected = false)
        Spacer(Modifier.height(8.dp))
        OfferStop(offerStopLine(offer.dropoff.address, offer.dropoff.landmark), pickup = false, connected = false)
    }
    if (detailed) {
        offer.parcel.instructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
    Spacer(Modifier.height(RidersSpacing.md))
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text("Distance", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(offerDistanceLabel(offer.distanceMeters), style = RidersType.heading, color = RidersColors.text)
        }
        Column(
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            Text("Price", style = RidersType.caption, color = RidersColors.textSecondary)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
            ) {
                Text(requestAmountLabel(offer.currency, offer.offeredPrice), style = RidersType.heading, color = RidersColors.text)
                RequestPaymentMark(offer.paymentMethod)
            }
        }
    }
}

/** Keep the server-adjusted snapshot clock moving while the offer is visible. */
@Composable
private fun rememberOfferCountdownNow(
    deliveryId: String,
    searchExpiresAt: String?,
    expiresAt: String,
    serverNowSnapshot: Long,
): Long {
    var now by remember(deliveryId, searchExpiresAt, expiresAt, serverNowSnapshot) { mutableLongStateOf(serverNowSnapshot) }
    LaunchedEffect(deliveryId, searchExpiresAt, expiresAt, serverNowSnapshot) {
        val startedAt = SystemClock.elapsedRealtime()
        while (true) {
            now = serverNowSnapshot + (SystemClock.elapsedRealtime() - startedAt)
            delay(250L)
        }
    }
    return now
}

@Composable
private fun OfferExpiry(expiresAt: String, searchExpiresAt: String?, nowMillis: Long, expired: Boolean, statusLabel: String? = null, fresh: Boolean = false) {
    if (statusLabel != null) {
        Text(
            statusLabel,
            modifier = Modifier
                .clip(RoundedCornerShape(RidersRadius.pill))
                .background(RidersColors.primaryLight)
                .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
            style = RidersType.captionStrong,
            color = RidersColors.primaryDark,
        )
        return
    }
    val display = com.riders.rider.feature.offers.domain.riderExpiryDisplay(searchExpiresAt, expiresAt, nowMillis)
    val isExpiredDisplay = display == "Expired"
    val remainingSeconds = if (isExpiredDisplay) 0L else {
        val expiryText = display.substringAfterLast(' ')
        val parts = expiryText.split(':')
        if (parts.size == 2) {
            val minutes = parts[0].toLongOrNull()
            val seconds = parts[1].toLongOrNull()
            if (minutes != null && seconds != null) minutes * 60L + seconds else 0L
        } else 0L
    }
    val color = when {
        isExpiredDisplay -> RidersColors.error
        remainingSeconds <= 60L -> RidersColors.error
        remainingSeconds <= 180L -> Color(0xFFB45309)
        else -> RidersColors.primaryDark
    }
    Text(
        text = display,
        modifier = Modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(color.copy(alpha = 0.10f))
            .padding(horizontal = 10.dp, vertical = 5.dp),
        style = RidersType.captionStrong.copy(
            fontSize = 15.sp,
            lineHeight = 20.sp,
            platformStyle = PlatformTextStyle(includeFontPadding = false),
            lineHeightStyle = LineHeightStyle(
                alignment = LineHeightStyle.Alignment.Center,
                trim = LineHeightStyle.Trim.None,
            ),
            textAlign = TextAlign.Center,
        ),
        color = color,
        textAlign = TextAlign.Center,
        maxLines = 1,
    )
}

@Composable
private fun OfferStop(
    line: String,
    pickup: Boolean,
    connected: Boolean,
    above: @Composable () -> Unit = {},
) {
    DeliveryStop(
        line,
        dropoff = !pickup,
        connect = false,
        pinColumn = cardLocationPinWidth,
        pinWidth = cardLocationPinWidth,
        pinHeight = cardLocationPinHeight,
        fontSize = 16.sp,
        lineHeight = 21.sp,
        above = above,
    )
}
