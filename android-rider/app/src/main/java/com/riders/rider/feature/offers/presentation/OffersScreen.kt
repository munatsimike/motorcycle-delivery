package com.riders.rider.feature.offers.presentation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersConfirmation
import com.riders.rider.core.design.RidersChangingText
import com.riders.rider.core.design.RidersMotion
import com.riders.rider.core.design.RiderTransition
import com.riders.rider.core.design.acceptPressEnabled
import com.riders.rider.core.design.acceptanceConfirmationVisible
import com.riders.rider.core.design.rememberRidersMotion
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
import com.riders.rider.feature.bids.domain.formatBidDollars
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.DeliveryStop
import com.riders.rider.feature.delivery.presentation.ServiceClassBadge
import com.riders.rider.feature.delivery.presentation.deliveryContentLabel
import com.riders.rider.feature.delivery.presentation.deliveryContentMatches
import com.riders.rider.feature.delivery.presentation.filteredContentTitle
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.offerDistanceLabel
import com.riders.rider.feature.offers.domain.OFFER_YOUR_PRICE
import com.riders.rider.feature.offers.domain.acceptOfferLabel
import com.riders.rider.feature.bids.domain.resolvedSubmittedAmount
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.senderChoosesRider
import com.riders.rider.feature.offers.domain.offerPriceLabel
import com.riders.rider.feature.offers.domain.offerStopLine
import com.riders.rider.navigation.bidOptionsEnter
import com.riders.rider.navigation.bidOptionsExit

@Composable
fun OffersScreen(
    onAccepted: (String) -> Unit,
    inShell: Boolean = false,
    modifier: Modifier = Modifier,
    offerAssignmentId: String? = null,
    contentKind: String? = null,
    model: OfferViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
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
    LaunchedEffect(offerAssignmentId) {
        val assignmentId = offerAssignmentId ?: return@LaunchedEffect
        model.openFromNotification(assignmentId)
    }
    val selected = ui.selected
    val placingBid = ui.placingBid
    BackHandler(enabled = selected != null) {
        if (placingBid) {
            model.closeBid()
        } else {
            model.select(null)
        }
    }
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = model::pullRefresh,
        modifier = modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .then(if (inShell) Modifier else Modifier.statusBarsPadding())
            .then(if (inShell) Modifier else Modifier.navigationBarsPadding()),
    ) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.lg)
            .padding(bottom = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        if (selected == null) {
            OfferList(
                ui,
                onAccept = { respondToOffer(model, it) },
                onBid = model::openBid,
                onSubmitBid = { offer, amount -> model.submitBid(offer.deliveryId, amount, offer.currency) },
                onInterest = model::expressInterest,
                onRetry = model::pullRefresh,
                contentKind = contentKind,
            )
        } else if (resolvedSubmittedAmount(ui.ownBids, selected.deliveryId, ui.sentAmounts[selected.deliveryId]) != null && !placingBid) {
            SentOfferDetails(
                selected,
                resolvedSubmittedAmount(ui.ownBids, selected.deliveryId, ui.sentAmounts[selected.deliveryId]).orEmpty(),
            )
        } else {
            OfferDetail(
                offer = selected,
                accepting = ui.accepting,
                submittingBid = ui.submittingBid,
                statusLabel = ui.sentLabels[selected.deliveryId],
                confirmed = acceptanceConfirmationVisible(ui.accepted != null),
                unavailable = ui.offerGone,
                nowMillis = ui.nowMillis,
                error = ui.bidError ?: ui.error,
                onAccept = { respondToOffer(model, selected) },
                onBid = { amount -> model.submitBid(selected.deliveryId, amount, selected.currency) },
                placingBid = placingBid,
                onCloseBid = model::closeBid,
                onViewDelivery = onAccepted,
                onRetry = model::pullRefresh,
            )
        }
    }
    }
}

@Composable
private fun OfferList(
    ui: OfferUi,
    onAccept: (OfferResponse) -> Unit,
    onBid: (OfferResponse) -> Unit,
    onSubmitBid: (OfferResponse, String) -> Unit,
    onInterest: (OfferResponse) -> Unit,
    onRetry: () -> Unit,
    contentKind: String? = null,
) {
    val shown = ui.offers.filter { deliveryContentMatches(it.parcel.description, contentKind) }
    when {
        ui.loading && ui.offers.isEmpty() -> RidersLoadingState("Looking for requests")
        ui.offers.isEmpty() && ui.error != null -> RidersFailureNotice(
            message = ui.error,
            title = "Requests unavailable",
            onRetry = onRetry,
        )
        shown.isEmpty() -> RidersEmptyState(
            title = filteredContentTitle(contentKind, "No open requests"),
            body = "New requests appear here while you stay available.",
            image = R.drawable.parcel_box,
        )
        else -> shown.forEach { offer ->
            val sentAmount = resolvedSubmittedAmount(ui.ownBids, offer.deliveryId, ui.sentAmounts[offer.deliveryId])
            OfferRequestCard(
                offer,
                ui.nowMillis,
                accepting = ui.accepting,
                statusLabel = if (sentAmount == null) ui.sentLabels[offer.deliveryId] else null,
                sentAmount = sentAmount,
                submittingBid = ui.submittingBid,
                bidsOpen = marketplaceBidButtonsVisible(offer.serviceClass, ui.ownBidsKnown, ui.bidError ?: ui.bidListError),
                onAccept = { onAccept(offer) },
                onBid = { onBid(offer) },
                onSubmitBid = { amount -> onSubmitBid(offer, amount) },
                onInterest = { onInterest(offer) },
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
private fun OfferDetail(
    offer: OfferResponse,
    accepting: Boolean,
    submittingBid: Boolean,
    statusLabel: String?,
    confirmed: Boolean,
    unavailable: Boolean,
    nowMillis: Long,
    error: String?,
    onAccept: () -> Unit,
    onBid: (String) -> Unit,
    placingBid: Boolean,
    onCloseBid: () -> Unit,
    onViewDelivery: (String) -> Unit,
    onRetry: () -> Unit,
) {
    val canAct = acceptPressEnabled(canAcceptOffer(offer.expiresAt, nowMillis, accepting, unavailable), confirmed = false)
    val content = offerContent(offer.parcel.description)
    val motion = rememberRidersMotion()
    val bidMs = motion.millis(RiderTransition.BidRise)
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        OfferSummary(offer, nowMillis, detailed = true, statusLabel = statusLabel)
    }
    AnimatedContent(
        targetState = placingBid,
        transitionSpec = {
            ContentTransform(
                targetContentEnter = bidOptionsEnter(bidMs),
                initialContentExit = bidOptionsExit(bidMs),
                sizeTransform = if (bidMs <= 0) null else SizeTransform(clip = false),
            )
        },
        label = "bid-options",
    ) { bidding ->
        if (bidding) {
            BidPage(
                offer = offer,
                content = content,
                submitting = submittingBid,
                canAct = canAct && !accepting,
                error = error,
                onSend = onBid,
                onRetry = onRetry,
                onBack = onCloseBid,
            )
        } else {
            OfferActions(
                offer = offer,
                accepting = accepting,
                submittingBid = submittingBid,
                confirmed = confirmed,
                canAct = canAct,
                error = error,
                onAccept = onAccept,
                onSubmitBid = onBid,
                onViewDelivery = onViewDelivery,
                onRetry = onRetry,
            )
        }
    }
}

@Composable
private fun OfferActions(
    offer: OfferResponse,
    accepting: Boolean,
    submittingBid: Boolean,
    confirmed: Boolean,
    canAct: Boolean,
    error: String?,
    onAccept: () -> Unit,
    onSubmitBid: (String) -> Unit,
    onViewDelivery: (String) -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        if (error != null) {
            RidersFailureNotice(message = error, onRetry = onRetry)
        }
        if (acceptanceConfirmationVisible(confirmed)) {
            RidersConfirmation("Delivery accepted!", Modifier.fillMaxWidth())
            Text(offerPriceLabel(offer.currency, offer.offeredPrice), style = RidersType.body, color = RidersColors.text)
            Text(offer.pickup.address, style = RidersType.body, color = RidersColors.text)
            Text(offer.dropoff.address, style = RidersType.body, color = RidersColors.text)
            RidersPrimaryButton(
                label = "View delivery",
                onClick = { onViewDelivery(offer.deliveryId) },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            IncomingOfferActions(
                offer = offer,
                canAct = canAct,
                accepting = accepting,
                submittingBid = submittingBid,
                onAccept = onAccept,
                onSubmitBid = onSubmitBid,
            )
        }
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
) {
    var offering by remember(offer.deliveryId) { mutableStateOf(false) }
    var amount by remember(offer.deliveryId, offer.offeredPrice) { mutableStateOf(offer.offeredPrice) }
    var sending by remember(offer.deliveryId) { mutableStateOf(false) }
    val cents = bidAmountCents(amount)
    LaunchedEffect(submittingBid) {
        if (sending && !submittingBid) {
            sending = false
            offering = false
        }
    }
    RidersBottomSheet(visible = offering, onDismiss = { if (!submittingBid) offering = false }) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            RidersTextField(
                label = "Your offer (USD)",
                value = amount,
                onValueChange = { amount = it },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                error = if (amount.isNotBlank() && cents == null) "Enter a price." else null,
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                RidersSecondaryButton(
                    label = "Cancel",
                    onClick = { offering = false },
                    enabled = !submittingBid,
                    modifier = Modifier.weight(1f),
                    soft = false,
                )
                RidersPrimaryButton(
                    label = "Send offer",
                    onClick = {
                        val parsed = bidAmountCents(amount) ?: return@RidersPrimaryButton
                        sending = true
                        onSubmitBid(formatBidDollars(parsed))
                    },
                    enabled = canAct && cents != null && !accepting,
                    loading = submittingBid,
                    loadingLabel = "Sending",
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        RidersSecondaryButton(
            label = OFFER_YOUR_PRICE,
            onClick = {
                amount = offer.offeredPrice
                offering = true
            },
            enabled = canAct && !accepting && !submittingBid,
            modifier = Modifier.weight(1f),
            soft = false,
        )
        RidersPrimaryButton(
            label = acceptOfferLabel(offer.currency, offer.offeredPrice),
            onClick = onAccept,
            enabled = canAct && !submittingBid,
            loading = accepting || submittingBid,
            loadingLabel = if (senderChoosesRider(offer.serviceClass)) "Sending" else "Accepting",
            modifier = Modifier.weight(1f),
        )
    }
}

private data class OfferContent(val label: String)

private fun offerContent(description: String): OfferContent {
    return OfferContent(deliveryContentLabel(description))
}

private const val BID_STEP_CENTS = 50

private fun startingBidCents(offeredPrice: String): Int {
    val cents = bidAmountCents(offeredPrice) ?: BID_STEP_CENTS
    val snapped = ((cents + BID_STEP_CENTS / 2) / BID_STEP_CENTS) * BID_STEP_CENTS
    return snapped.coerceAtLeast(BID_STEP_CENTS)
}

private fun bidSuggestions(cents: Int): List<Int> {
    val anchor = ((cents + 25) / 50) * 50
    val start = (anchor - 100).coerceAtLeast(BID_STEP_CENTS)
    return List(4) { index -> start + index * BID_STEP_CENTS }
}

private fun deliveryKindWord(label: String): String = if (label == "Document") "doc" else label.lowercase()

@Composable
private fun BidPage(
    offer: OfferResponse,
    content: OfferContent,
    submitting: Boolean,
    canAct: Boolean,
    error: String?,
    onSend: (String) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    var cents by remember(offer.deliveryId) { mutableStateOf(startingBidCents(offer.offeredPrice)) }
    var confirmSend by remember(offer.deliveryId) { mutableStateOf(false) }
    val amount = formatBidDollars(cents)
    val suggestions = bidSuggestions(startingBidCents(offer.offeredPrice))
    if (confirmSend) {
        AlertDialog(
            onDismissRequest = { if (!submitting) confirmSend = false },
            title = { Text("Send bid", style = RidersType.heading, color = RidersColors.text) },
            text = {
                Text(
                    "You are sending a bid of ${offerPriceLabel(offer.currency, amount)} to deliver the ${deliveryKindWord(content.label)}.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmSend = false
                        onSend(amount)
                    },
                    enabled = !submitting,
                ) {
                    Text("Send bid", color = RidersColors.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmSend = false }, enabled = !submitting) {
                    Text("Cancel", color = RidersColors.textSecondary)
                }
            },
        )
    }
    val motion = rememberRidersMotion()
    val choiceMs = motion.duration(RidersMotion.CONTENT_MS)
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
    if (error != null) {
        RidersFailureNotice(message = error, onRetry = onRetry)
    }
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
            Text("Your bid amount", style = RidersType.caption, color = RidersColors.textSecondary)
            Row(
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .height(56.dp)
                        .padding(horizontal = RidersSpacing.md),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    RidersChangingText(
                        value = offerPriceLabel(offer.currency, amount),
                        style = RidersType.heading,
                        color = RidersColors.text,
                    )
                }
                BidStepButton("−", enabled = canAct && cents > BID_STEP_CENTS) {
                    cents = (cents - BID_STEP_CENTS).coerceAtLeast(BID_STEP_CENTS)
                }
                BidStepButton("+", enabled = canAct) {
                    cents += BID_STEP_CENTS
                }
            }
            Text(
                "Suggested bid (based on distance and demand)",
                style = RidersType.caption,
                color = RidersColors.textSecondary,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
                suggestions.forEach { choice ->
                    val selectedChoice = choice == cents
                    val shape = RoundedCornerShape(RidersRadius.md)
                    val fill by animateColorAsState(
                        targetValue = if (selectedChoice) RidersColors.primaryLight else RidersColors.background,
                        animationSpec = tween(choiceMs),
                        label = "bid-choice-fill",
                    )
                    val stroke by animateColorAsState(
                        targetValue = if (selectedChoice) RidersColors.primary else RidersColors.border,
                        animationSpec = tween(choiceMs),
                        label = "bid-choice-border",
                    )
                    val labelColor by animateColorAsState(
                        targetValue = if (selectedChoice) RidersColors.primaryDark else RidersColors.text,
                        animationSpec = tween(choiceMs),
                        label = "bid-choice-label",
                    )
                    Box(
                        Modifier
                            .weight(1f)
                            .height(44.dp)
                            .clip(shape)
                            .background(fill)
                            .border(1.dp, stroke, shape)
                            .clickable(enabled = canAct, role = Role.Button) { cents = choice },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            formatBidDollars(choice),
                            style = RidersType.caption.copy(fontWeight = FontWeight.SemiBold),
                            color = labelColor,
                        )
                    }
                }
            }
        }
        RidersPrimaryButton(
            label = "Send bid",
            onClick = { confirmSend = true },
            enabled = canAct && !submitting,
            loading = submitting,
            loadingLabel = "Sending",
            modifier = Modifier.fillMaxWidth(),
        )
    RidersSecondaryButton(label = "Cancel", onClick = onBack, modifier = Modifier.fillMaxWidth(), soft = false)
    }
}

@Composable
private fun BidStepButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(RidersRadius.md)
    Box(
        Modifier
            .size(56.dp)
            .clip(shape)
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = RidersType.heading, color = if (enabled) RidersColors.text else RidersColors.textSecondary)
    }
}

@Composable
private fun SentOfferCard(offer: OfferResponse, amount: String) {
    var open by remember(offer.deliveryId) { mutableStateOf(false) }
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        SentOfferHeading()
        SentOfferNote(offer, amount)
        HorizontalDivider()
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Your offer", style = RidersType.body, color = RidersColors.textSecondary)
            Text(
                offerPriceLabel(offer.currency, amount),
                style = RidersType.bodyStrong,
                color = RidersColors.text,
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.clickable(role = Role.Button, onClick = { open = true }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Parcel details",
                    style = RidersType.button.copy(fontWeight = FontWeight.Medium),
                    color = RidersColors.primary,
                )
                Icon(
                    painter = painterResource(R.drawable.ic_chevron_up),
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = RidersColors.primary,
                )
            }
        }
    }
    OfferDetailsSheet(visible = open, offer = offer, amount = amount, onDismiss = { open = false })
}

@Composable
private fun OfferDetailsSheet(visible: Boolean, offer: OfferResponse, amount: String, onDismiss: () -> Unit) {
    RidersBottomSheet(visible = visible, onDismiss = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ContentIcon(offer.parcel.description)
                ContentLabel(offer.parcel.description)
                ServiceClassBadge(offer.serviceClass)
            }
            Column(Modifier.fillMaxWidth()) {
                OfferStop("Pickup", offerStopLine(offer.pickup.address, offer.pickup.landmark), pickup = true, connected = true)
                OfferStop("Drop-off", offerStopLine(offer.dropoff.address, offer.dropoff.landmark), pickup = false, connected = false)
            }
            HorizontalDivider()
            DetailLine("Distance", offerDistanceLabel(offer.distanceMeters))
            DetailLine("Customer price", offerPriceLabel(offer.currency, offer.offeredPrice))
            DetailLine("Your offer", offerPriceLabel(offer.currency, amount))
        }
    }
}

@Composable
private fun SentOfferDetails(offer: OfferResponse, amount: String) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        SentOfferHeading()
        SentOfferNote(offer, amount)
        HorizontalDivider()
        Column(Modifier.fillMaxWidth()) {
            OfferStop("Pickup", offerStopLine(offer.pickup.address, offer.pickup.landmark), pickup = true, connected = true)
            OfferStop("Drop-off", offerStopLine(offer.dropoff.address, offer.dropoff.landmark), pickup = false, connected = false)
        }
        offer.parcel.instructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        DetailLine("Distance", offerDistanceLabel(offer.distanceMeters))
        DetailLine("Your offer", offerPriceLabel(offer.currency, amount))
        DetailLine("Pays", readableOfferValue(offer.payer))
        DetailLine("Method", readableOfferValue(offer.paymentMethod))
    }
}

@Composable
private fun SentOfferHeading() {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(RidersColors.primaryLight),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_check),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = RidersColors.primary,
            )
        }
        Text("Offer sent", style = RidersType.bodyStrong, color = RidersColors.text)
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

@Composable
private fun DetailLine(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = RidersType.body, color = RidersColors.textSecondary)
        Text(value, style = RidersType.bodyStrong, color = RidersColors.text)
    }
}

@Composable
private fun HorizontalDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, RidersColors.border, Color.Transparent),
                ),
            ),
    )
}

private fun readableOfferValue(value: String): String {
    val words = value.trim().lowercase().split('_').filter { it.isNotEmpty() }
    if (words.isEmpty()) {
        return value
    }
    return words.joinToString(" ") { word -> word.replaceFirstChar { it.titlecase(java.util.Locale.US) } }
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
    @Suppress("UNUSED_PARAMETER") onInterest: () -> Unit = {},
) {
    if (sentAmount != null) {
        SentOfferCard(offer, sentAmount)
        return
    }
    var awaiting by remember(offer.deliveryId) { mutableStateOf(false) }
    LaunchedEffect(accepting, submittingBid) {
        if (!accepting && !submittingBid) {
            awaiting = false
        }
    }
    val canAct = bidsOpen && acceptPressEnabled(
        canAcceptOffer(offer.expiresAt, nowMillis, accepting = false, unavailable = false),
        confirmed = false,
    ) && !accepting && !submittingBid
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        OfferSummary(offer, nowMillis, detailed = false, statusLabel = statusLabel)
        if (bidsOpen || !senderChoosesRider(offer.serviceClass)) {
            if (offer.serviceClass == "EXPRESS" && statusLabel != null) {
                Text(statusLabel, style = RidersType.body, color = RidersColors.textSecondary)
            } else if (statusLabel == null) {
                IncomingOfferActions(
                    offer = offer,
                    canAct = canAct,
                    accepting = awaiting && accepting,
                    submittingBid = awaiting && submittingBid,
                    onAccept = {
                        awaiting = true
                        onAccept()
                    },
                    onSubmitBid = { amount ->
                        awaiting = true
                        onSubmitBid(amount)
                    },
                )
            }
        }
    }
}

@Composable
private fun OfferSummary(offer: OfferResponse, nowMillis: Long, detailed: Boolean, statusLabel: String? = null) {
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
            ContentIcon(offer.parcel.description)
            ContentLabel(offer.parcel.description)
            ServiceClassBadge(offer.serviceClass)
        }
        if (hasDeadline || statusLabel != null) {
            OfferExpiry(offer.expiresAt, nowMillis, expired, statusLabel)
        }
    }
    Column(Modifier.fillMaxWidth()) {
        OfferStop("Pickup", offerStopLine(offer.pickup.address, offer.pickup.landmark), pickup = true, connected = true)
        OfferStop("Drop-off", offerStopLine(offer.dropoff.address, offer.dropoff.landmark), pickup = false, connected = false)
    }
    if (detailed) {
        offer.parcel.instructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(RidersColors.border),
    )
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text("Distance", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(offerDistanceLabel(offer.distanceMeters), style = RidersType.body, color = RidersColors.text)
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            Text("Customer offers", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(offerPriceLabel(offer.currency, offer.offeredPrice), style = RidersType.heading, color = RidersColors.text)
        }
    }
}

@Composable
private fun OfferExpiry(expiresAt: String, nowMillis: Long, expired: Boolean, statusLabel: String? = null) {
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
    val motion = rememberRidersMotion()
    val expiryDuration = motion.duration(RidersMotion.CONTENT_MS)
    val expiryColor by animateColorAsState(
        targetValue = if (expired) RidersColors.error else Color(0xFFB45309),
        animationSpec = tween(expiryDuration),
        label = "expiry-color",
    )
    val expiryFill by animateColorAsState(
        targetValue = if (expired) RidersColors.dangerSurface else Color(0xFFFEF3C7),
        animationSpec = tween(expiryDuration),
        label = "expiry-fill",
    )
    Row(
        Modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(expiryFill)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_clock),
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = expiryColor,
        )
        Text(offerExpiryLabel(expiresAt, nowMillis), style = RidersType.captionStrong, color = expiryColor)
    }
}

@Composable
private fun OfferStop(title: String, line: String, pickup: Boolean, connected: Boolean) {
    DeliveryStop(title, line, dropoff = !pickup, connect = connected)
}
