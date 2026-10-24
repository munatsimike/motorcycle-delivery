package com.riders.rider.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.feature.offers.notification.rememberOfferInbox
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.feature.delivery.presentation.AssignmentListPane
import com.riders.rider.feature.offers.presentation.OffersScreen
import com.riders.rider.feature.bids.presentation.BidBoardScreen
import com.riders.rider.navigation.deliveriesShowsActiveDelivery
import com.riders.rider.navigation.deliveriesShowsAssignmentList
import com.riders.rider.navigation.deliveriesShowsBidBoard
import com.riders.rider.navigation.deliveriesShowsOffers

private enum class DeliveryTab {
    Active,
    Requests,
    History,
}

@Composable
fun DeliveriesScreen(
    onAccepted: (String) -> Unit,
    onOpenDelivery: (String) -> Unit,
    offerTap: PendingOffer? = null,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val pending = offerTap ?: rememberOfferInbox()
    val offerAssignmentId by pending.taps.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(DeliveryTab.Active) }
    var requestUnavailable by remember { mutableStateOf(false) }
    val availability = ui.onboarding?.availability
    LaunchedEffect(offerAssignmentId, availability) {
        val assignmentId = offerAssignmentId ?: return@LaunchedEffect
        if (availability == null) {
            return@LaunchedEffect
        }
        if (availability != "AVAILABLE") {
            requestUnavailable = true
            pending.clear()
            return@LaunchedEffect
        }
        requestUnavailable = false
        if (assignmentId.isNotEmpty() && tab != DeliveryTab.Active) {
            tab = DeliveryTab.Active
        }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding(),
    ) {
        val marketplace = deliveriesShowsBidBoard(ui.onboarding?.receiving)
        val committed = ui.committedV2
        val tabs = if (marketplace) {
            listOf(DeliveryTab.Active, DeliveryTab.Requests, DeliveryTab.History)
        } else {
            listOf(DeliveryTab.Active, DeliveryTab.History)
        }
        val selected = if (tab in tabs) tab else DeliveryTab.Active
        DeliveryTabs(
            tabs = tabs,
            selected = selected,
            onSelect = { tab = it },
            modifier = Modifier.padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        )
        when (selected) {
            DeliveryTab.History -> HistoryDeliveries(Modifier.weight(1f))
            DeliveryTab.Requests -> BidBoardScreen(
                onOpenDelivery = onOpenDelivery,
                modifier = Modifier.weight(1f),
            )
            DeliveryTab.Active -> when {
                ui.loading && ui.onboarding == null -> RidersLoadingState("Loading your deliveries")
                ui.assignmentsUnknown -> RidersFailureNotice(
                    message = ui.error ?: "Your deliveries could not be loaded. Check your connection and try again.",
                    title = "Deliveries unavailable",
                    onRetry = model::refresh,
                    modifier = Modifier.weight(1f),
                )
                deliveriesShowsAssignmentList(ui.onboarding?.receiving, committed) -> AssignmentListPane(
                    onOpen = onOpenDelivery,
                    availability = availability,
                    receiving = ui.onboarding?.receiving,
                    modifier = Modifier.weight(1f),
                )
                deliveriesShowsOffers(availability) -> OffersScreen(
                    onAccepted = onAccepted,
                    inShell = true,
                    offerAssignmentId = offerAssignmentId,
                    modifier = Modifier.weight(1f),
                )
                deliveriesShowsActiveDelivery(availability) -> RidersPullRefresh(
                    refreshing = ui.refreshing,
                    onRefresh = model::refresh,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = RidersSpacing.xl)
                            .padding(bottom = RidersSpacing.lg),
                        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                    ) {
                        if (requestUnavailable) {
                            UnavailableRequestNotice()
                        }
                        ActiveDeliverySection(ui, onOpenDelivery)
                    }
                }
                else -> RidersPullRefresh(
                    refreshing = ui.refreshing,
                    onRefresh = model::refresh,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = RidersSpacing.xl)
                            .padding(bottom = RidersSpacing.lg),
                    ) {
                        if (requestUnavailable) {
                            UnavailableRequestNotice()
                        }
                        RidersEmptyState(
                            title = "No delivery requests",
                            body = ui.readiness?.message ?: "Go online from Home to receive delivery requests.",
                            image = R.drawable.parcel_box,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryDeliveries(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.xl)
            .padding(bottom = RidersSpacing.lg),
    ) {
        RidersEmptyState(
            title = "No past deliveries",
            body = "Completed deliveries will appear here.",
            image = R.drawable.parcel_box,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun UnavailableRequestNotice() {
    Text(
        REQUEST_UNAVAILABLE,
        style = RidersType.body,
        color = RidersColors.textSecondary,
    )
}

@Composable
private fun DeliveryTabs(
    tabs: List<DeliveryTab>,
    selected: DeliveryTab,
    onSelect: (DeliveryTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        tabs.forEach { tab ->
            val isSelected = tab == selected
            val shape = RoundedCornerShape(RidersRadius.lg)
            Box(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 44.dp)
                    .clip(shape)
                    .background(if (isSelected) RidersColors.primaryLight else RidersColors.background)
                    .border(1.dp, if (isSelected) RidersColors.primary else RidersColors.border, shape)
                    .clickable(role = Role.Button, onClick = { onSelect(tab) })
                    .semantics { this.selected = isSelected }
                    .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    when (tab) {
                        DeliveryTab.Active -> "Active"
                        DeliveryTab.Requests -> "Requests"
                        DeliveryTab.History -> "History"
                    },
                    style = RidersType.body.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                    color = if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary,
                )
            }
        }
    }
}
