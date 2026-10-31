package com.riders.rider.feature.bids.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.bids.domain.BidBoardPhase
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidBoardPhase
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import com.riders.rider.feature.bids.domain.bidOutcome
import com.riders.rider.feature.bids.domain.offerListStatus
import com.riders.rider.feature.bids.domain.visibleBids
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.destinationSuburb
import com.riders.rider.feature.delivery.domain.sortDeliveries
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.ServiceClassBadge
import com.riders.rider.feature.delivery.presentation.deliveryContentMatches
import com.riders.rider.feature.delivery.presentation.filteredContentTitle
import com.riders.rider.feature.offers.domain.offerPriceLabel

@Composable
fun BidBoardScreen(
    contentKind: String? = null,
    sort: DeliveryListSort = DeliveryListSort.Newest,
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
    val phase = bidBoardPhase(ui.loading, requestCount = 0, bidCount = ui.bids.size, error = ui.error)
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = model::refresh, modifier = modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            when (phase) {
                BidBoardPhase.Loading -> RidersLoadingState("Loading your offers")
                BidBoardPhase.Failed -> RidersFailureNotice(
                    message = ui.error.orEmpty(),
                    title = "Offers unavailable",
                    onRetry = model::refresh,
                )
                BidBoardPhase.Empty -> RidersEmptyState(
                    title = filteredContentTitle(contentKind, "No offers yet"),
                    body = "Offers you send from Home appear here.",
                    image = R.drawable.parcel_box,
                    modifier = Modifier.fillMaxWidth(),
                )
                BidBoardPhase.Ready -> {
                    val shown = sortDeliveries(
                        visibleBids(ui.bids, null).filter { deliveryContentMatches(it.parcelDescription, contentKind) },
                        sort,
                        { it.createdAt },
                        { it.distanceMeters },
                        { it.amount },
                        { it.bidId },
                    )
                    if (shown.isEmpty()) {
                        RidersEmptyState(
                            title = filteredContentTitle(contentKind, "No offers yet"),
                            body = "Offers you send from Home appear here.",
                            image = R.drawable.parcel_box,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Column(Modifier.fillMaxWidth()) {
                        shown.forEachIndexed { index, bid ->
                            OwnBidRow(
                                bid = bid,
                                withdrawing = ui.withdrawingBidId == bid.bidId,
                                onWithdraw = { model.withdraw(bid.bidId) },
                            )
                            if (index < shown.lastIndex) {
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(start = 34.dp)
                                        .height(1.dp)
                                        .background(RidersColors.border),
                                )
                            }
                        }
                    }
                    if (ui.nextCursor != null) {
                        RidersSecondaryButton(
                            label = if (ui.loadingMore) "Loading offers" else "More offers",
                            onClick = model::loadMore,
                            enabled = !ui.loadingMore,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            if (ui.error != null && ui.bids.isNotEmpty()) {
                RidersFailureNotice(message = ui.error.orEmpty(), onRetry = model::refresh)
            }
        }
    }
}

@Composable
private fun OwnBidRow(
    bid: OwnBid,
    withdrawing: Boolean,
    onWithdraw: () -> Unit,
) {
    val suburb = destinationSuburb(bid.dropoffAddress)
    val customer = bid.suggestedPrice.trim().takeIf { it.isNotEmpty() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        ContentIcon(bid.parcelDescription, size = 22.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                ContentLabel(bid.parcelDescription)
                if (bid.serviceClass == "EXPRESS" || bid.serviceClass == "FLEXIBLE") {
                    ServiceClassBadge(bid.serviceClass)
                }
            }
            if (suburb.isNotBlank()) {
                Text(
                    suburb,
                    style = RidersType.caption,
                    color = RidersColors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (bid.status == "SUPERSEDED") {
                bidOutcome(bid.status, bid.serviceClass)?.let { outcome ->
                    Text(
                        outcome,
                        style = RidersType.caption,
                        color = RidersColors.textSecondary,
                        maxLines = 2,
                    )
                }
            }
            if (customer != null) {
                Text(
                    "Customer ${offerPriceLabel(bid.currency, customer)}",
                    style = RidersType.caption,
                    color = RidersColors.textSecondary,
                    maxLines = 1,
                )
            }
            if (bidCanWithdraw(bid.status)) {
                Text(
                    if (withdrawing) "Withdrawing" else "Withdraw",
                    style = RidersType.captionStrong,
                    color = RidersColors.primaryDark,
                    modifier = Modifier.clickable(enabled = !withdrawing, role = Role.Button, onClick = onWithdraw),
                )
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                offerListStatus(bid.status),
                style = RidersType.captionStrong,
                color = offerStatusColor(bid.status),
                maxLines = 1,
            )
            Text("Your offer", style = RidersType.caption, color = RidersColors.textSecondary, maxLines = 1)
            Text(
                offerPriceLabel(bid.currency, bid.amount),
                style = RidersType.bodyStrong,
                color = RidersColors.text,
                maxLines = 1,
            )
        }
    }
}

private fun offerStatusColor(status: String): Color = when (status) {
    "ACCEPTED" -> RidersColors.primaryDark
    "SUPERSEDED" -> RidersColors.error
    "OPEN" -> Color(0xFFB45309)
    else -> RidersColors.textSecondary
}
