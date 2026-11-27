package com.riders.rider.feature.bids.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.LocalRidersToast
import kotlinx.coroutines.flow.collect
import com.riders.rider.R
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersDialogTone
import com.riders.rider.core.design.RidersInlineAction
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersCenteredContent
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersTransientNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.bids.domain.AWAITING_CUSTOMER_RESPONSE
import com.riders.rider.feature.bids.domain.BidBoardPhase
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidBoardPhase
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import com.riders.rider.feature.bids.domain.pendingBids
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.sortDeliveries
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.cardLocationPinWidth
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.ServiceClassLabel
import com.riders.rider.feature.delivery.presentation.DeliveryRoute
import com.riders.rider.feature.delivery.presentation.DeliveryListCardElevation
import com.riders.rider.feature.delivery.presentation.DeliveryListCardShadowColor
import com.riders.rider.feature.offers.domain.OFFER_REFRESH_INTERVAL_MS
import com.riders.rider.feature.offers.domain.shouldPollMarketplace
import com.riders.rider.feature.delivery.presentation.deliveryContentMatches
import com.riders.rider.feature.delivery.presentation.filteredContentTitle
import com.riders.rider.feature.offers.domain.offerPriceLabel
import com.riders.rider.feature.offers.presentation.MapOfferDialogButtons

@Composable
fun BidBoardScreen(
    contentKind: String? = null,
    sort: DeliveryListSort = DeliveryListSort.Newest,
    availability: String? = null,
    receiving: Boolean? = null,
    modifier: Modifier = Modifier,
    model: BidBoardViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val showToast = LocalRidersToast.current
    LaunchedEffect(model) {
        model.successToasts.collect { event -> showToast(event) }
    }
    var confirmWithdraw by remember { mutableStateOf<String?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var appVisible by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> appVisible = true
                Lifecycle.Event.ON_STOP -> appVisible = false
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val poll = shouldPollMarketplace(appVisible, availability, receiving)
    LaunchedEffect(Unit) {
        if (!poll) {
            model.refresh()
        }
    }
    LaunchedEffect(poll) {
        if (!poll) {
            return@LaunchedEffect
        }
        model.refresh()
        while (isActive) {
            delay(OFFER_REFRESH_INTERVAL_MS)
            model.refresh()
        }
    }
    val listState = rememberLazyListState()
    val pending = remember(ui.bids) { pendingBids(ui.bids) }
    val phase = bidBoardPhase(ui.loading, requestCount = 0, bidCount = pending.size, error = ui.error)
    val shown = remember(pending, contentKind, sort) { sortDeliveries(
        pending.filter { deliveryContentMatches(it.parcelDescription, contentKind) },
        sort,
        { it.createdAt },
        { it.distanceMeters },
        { it.amount },
        { it.bidId },
    )
    }
    RidersTransientNotice(ui.error.takeIf { pending.isNotEmpty() }, passive = true)
    val centered = phase != BidBoardPhase.Ready || shown.isEmpty()
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = model::pullRefresh, modifier = modifier) {
        if (centered) {
            RidersCenteredContent(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(bottom = RidersSpacing.lg),
            ) {
                when (phase) {
                    BidBoardPhase.Loading -> RidersLoadingState("Loading your offers")
                    BidBoardPhase.Failed -> RidersFailureNotice(
                        message = ui.error.orEmpty(),
                        title = "Offers unavailable",
                        onRetry = model::refresh,
                    )
                    else -> RidersEmptyState(
                        title = filteredContentTitle(contentKind, "No pending offers"),
                        body = "Offers awaiting customer responses will appear here.",
                        image = R.drawable.parcel_box,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.lg),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            item(key = "heading") { Text(
                AWAITING_CUSTOMER_RESPONSE,
                style = RidersType.captionStrong,
                color = Color(0xFFB45309),
            ) }
            items(shown, key = { "bid:${it.bidId}" }, contentType = { "bid" }) { bid ->
                    OwnBidRow(
                        bid = bid,
                        withdrawing = ui.withdrawingBidId == bid.bidId,
                        onWithdraw = { confirmWithdraw = bid.bidId },
                    )
            }
        }
        }
    }
    val pendingWithdraw = confirmWithdraw
    RidersDialog(visible = pendingWithdraw != null, onDismiss = { confirmWithdraw = null }) {
        RidersDialogTitle("Withdraw offer?")
        RidersDialogBody("The customer will no longer see this offer.")
        MapOfferDialogButtons(
            confirmLabel = "Withdraw",
            dismissLabel = "Keep offer",
            confirmTone = RidersDialogTone.Danger,
            onConfirm = {
                val bidId = pendingWithdraw ?: return@MapOfferDialogButtons
                confirmWithdraw = null
                model.withdraw(bidId)
            },
            onDismiss = { confirmWithdraw = null },
            confirmEnabled = pending.any { it.bidId == pendingWithdraw } && ui.withdrawingBidId == null,
            dismissEnabled = true,
        )
    }
}

@Composable
private fun OwnBidRow(
    bid: OwnBid,
    withdrawing: Boolean,
    onWithdraw: () -> Unit,
) {
    RidersCard(
        modifier = Modifier.fillMaxWidth(),
        topPadding = RidersSpacing.md,
        bottomPadding = RidersSpacing.sm,
        itemSpacing = RidersSpacing.xs,
        elevation = DeliveryListCardElevation,
        shadowColor = DeliveryListCardShadowColor,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            ContentIcon(bid.parcelDescription, size = 15.dp, muted = true)
            ContentLabel(bid.parcelDescription, compact = true)
            ServiceClassLabel(bid.serviceClass)
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Your offer", style = RidersType.caption, color = RidersColors.textSecondary, maxLines = 1)
                Text(
                    offerPriceLabel(bid.currency, bid.amount),
                    style = RidersType.bodyStrong,
                    color = RidersColors.text,
                    maxLines = 1,
                )
            }
        }
        DeliveryRoute(
            bid.pickupAddress,
            bid.dropoffAddress,
            modifier = Modifier.offset(x = -((cardLocationPinWidth - 15.dp) / 2)),
            constantSpacing = true,
            addressFontSize = 16.sp,
            addressLineHeight = 21.sp,
        )
        if (bidCanWithdraw(bid.status)) {
            WithdrawAction(withdrawing, onWithdraw)
        }
    }
}

@Composable
private fun WithdrawAction(withdrawing: Boolean, onWithdraw: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        RidersInlineAction(
            label = "Withdraw",
            loadingLabel = "Withdrawing",
            loading = withdrawing,
            onClick = onWithdraw,
            color = RidersColors.error,
            style = RidersType.captionStrong,
            textAlign = TextAlign.End,
        )
    }
}
