package com.riders.rider.feature.bids.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.bids.domain.EXPRESS_BIDS_UNAVAILABLE
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.BidBoardPhase
import com.riders.rider.feature.bids.domain.bidAmountLabel
import com.riders.rider.feature.bids.domain.bidBoardPhase
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import com.riders.rider.feature.bids.domain.bidStatusLabel
import com.riders.rider.feature.bids.domain.openBidFor
import com.riders.rider.feature.bids.domain.parcelSummary
import com.riders.rider.feature.bids.domain.suggestedPriceLabel
import com.riders.rider.feature.delivery.domain.deadlineLabel
import com.riders.rider.feature.delivery.domain.serviceClassLabel

@Composable
fun BidBoardScreen(
    onOpenDelivery: (String) -> Unit,
    modifier: Modifier = Modifier,
    model: BidBoardViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) { model.refresh() }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.refresh()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val selected = ui.requests.firstOrNull { it.id == ui.selectedRequestId }
    val phase = bidBoardPhase(ui.loading, ui.requests.size, ui.bids.size, ui.error)
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = model::refresh, modifier = modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.xl)
                .padding(bottom = RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            if (ui.expressBlocksBids) {
                Text(EXPRESS_BIDS_UNAVAILABLE, style = RidersType.body, color = RidersColors.textSecondary)
            }
            when {
                phase == BidBoardPhase.Loading -> RidersLoadingState("Looking for requests")
                phase == BidBoardPhase.Failed -> RidersFailureNotice(
                    message = ui.error.orEmpty(),
                    title = "Requests unavailable",
                    onRetry = model::refresh,
                )
                selected != null -> RequestDetail(
                    request = selected,
                    ownBid = openBidFor(ui.bids, selected.id),
                    amount = ui.amountText,
                    amountError = ui.amountError,
                    submitting = ui.submitting,
                    bidsUnavailable = ui.expressBlocksBids,
                    onAmount = model::amountChanged,
                    onSubmit = { model.submit(selected.id) },
                    onWithdraw = model::withdraw,
                    withdrawing = ui.withdrawingBidId != null,
                    onBack = { model.select(null) },
                )
                ui.requests.isEmpty() -> RidersEmptyState(
                    title = "No open requests",
                    body = "New requests appear here while you are receiving work.",
                    image = R.drawable.parcel_box,
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> ui.requests.forEach { request ->
                    RequestCard(request, onSelect = { model.select(request.id) })
                }
            }
            if (ui.error != null && (ui.requests.isNotEmpty() || ui.bids.isNotEmpty())) {
                RidersFailureNotice(message = ui.error.orEmpty(), onRetry = model::refresh)
            }
            if (phase != BidBoardPhase.Loading && phase != BidBoardPhase.Failed) {
                Text("Your bids", style = RidersType.heading, color = RidersColors.text)
                if (ui.bids.isEmpty()) {
                    Text("You have no bids yet.", style = RidersType.body, color = RidersColors.textSecondary)
                } else {
                    ui.bids.forEach { bid ->
                        OwnBidCard(
                            bid = bid,
                            withdrawing = ui.withdrawingBidId == bid.bidId,
                            onWithdraw = { model.withdraw(bid.bidId) },
                            onOpen = { onOpenDelivery(bid.deliveryId) },
                        )
                    }
                    if (ui.nextCursor != null) {
                        RidersSecondaryButton(
                            label = if (ui.loadingMore) "Loading bids" else "More bids",
                            onClick = model::loadMore,
                            enabled = !ui.loadingMore,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RequestCard(request: OpenBidRequest, onSelect: () -> Unit) {
    RidersCard(onClick = onSelect, modifier = Modifier.fillMaxWidth()) {
        RequestFacts(request)
    }
}

@Composable
private fun RequestDetail(
    request: OpenBidRequest,
    ownBid: OwnBid?,
    amount: String,
    amountError: String?,
    submitting: Boolean,
    bidsUnavailable: Boolean,
    onAmount: (String) -> Unit,
    onSubmit: () -> Unit,
    onWithdraw: (String) -> Unit,
    withdrawing: Boolean,
    onBack: () -> Unit,
) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        RequestFacts(request)
        if (ownBid != null) {
            Text(bidAmountLabel(ownBid.currency, ownBid.amount), style = RidersType.bodyStrong, color = RidersColors.text)
            Text(bidStatusLabel(ownBid.status), style = RidersType.caption, color = RidersColors.textSecondary)
            if (bidCanWithdraw(ownBid.status)) {
                RidersSecondaryButton(
                    label = "Withdraw bid",
                    onClick = { onWithdraw(ownBid.bidId) },
                    enabled = !withdrawing,
                    loading = withdrawing,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else if (!bidsUnavailable) {
            RidersTextField(
                label = "Your bid (USD)",
                value = amount,
                onValueChange = onAmount,
                placeholder = "0.00",
                error = amountError,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            RidersPrimaryButton(
                label = "Submit bid",
                onClick = onSubmit,
                enabled = !submitting,
                loading = submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        RidersSecondaryButton(label = "Back", onClick = onBack, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun RequestFacts(request: OpenBidRequest) {
    serviceClassLabel(request.serviceClass)?.let { label ->
        Text(label, style = RidersType.captionStrong, color = RidersColors.primaryDark)
    }
    val summary = parcelSummary(request.parcelDescription, request.parcelSize)
    if (summary.isNotEmpty()) {
        Text(summary, style = RidersType.bodyStrong, color = RidersColors.text)
    }
    Text("Pickup", style = RidersType.caption, color = RidersColors.textSecondary)
    Text(request.pickupAddress, style = RidersType.body, color = RidersColors.text)
    Text("Drop-off", style = RidersType.caption, color = RidersColors.textSecondary)
    Text(request.dropoffAddress, style = RidersType.body, color = RidersColors.text)
    deadlineLabel(request.deliverBy)?.let { label ->
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
    }
    suggestedPriceLabel(request.suggestedPrice)?.let { label ->
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
    }
}

@Composable
private fun OwnBidCard(
    bid: OwnBid,
    withdrawing: Boolean,
    onWithdraw: () -> Unit,
    onOpen: () -> Unit,
) {
    RidersCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = if (bid.status == "ACCEPTED") onOpen else null,
    ) {
        serviceClassLabel(bid.serviceClass)?.let { label ->
            Text(label, style = RidersType.captionStrong, color = RidersColors.primaryDark)
        }
        Text(bidAmountLabel(bid.currency, bid.amount), style = RidersType.bodyStrong, color = RidersColors.text)
        Text(bidStatusLabel(bid.status), style = RidersType.body, color = RidersColors.text)
        if (bid.pickupAddress.isNotBlank()) {
            Text(bid.pickupAddress, style = RidersType.body, color = RidersColors.text)
        }
        if (bid.dropoffAddress.isNotBlank()) {
            Text(bid.dropoffAddress, style = RidersType.body, color = RidersColors.text)
        }
        deadlineLabel(bid.deliverBy)?.let { label ->
            Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        if (bidCanWithdraw(bid.status)) {
            RidersSecondaryButton(
                label = "Withdraw bid",
                onClick = onWithdraw,
                enabled = !withdrawing,
                loading = withdrawing,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
