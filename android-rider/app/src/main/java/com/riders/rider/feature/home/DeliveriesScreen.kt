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
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.offers.presentation.OffersScreen
import com.riders.rider.navigation.deliveriesShowsActiveDelivery
import com.riders.rider.navigation.deliveriesShowsOffers

private enum class DeliveryTab {
    Active,
    History,
}

@Composable
fun DeliveriesScreen(
    onAccepted: (String) -> Unit,
    onOpenDelivery: (String) -> Unit,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(DeliveryTab.Active) }
    val availability = ui.onboarding?.availability
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding(),
    ) {
        DeliveryTabs(
            selected = tab,
            onSelect = { tab = it },
            modifier = Modifier.padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        )
        when (tab) {
            DeliveryTab.History -> HistoryDeliveries(Modifier.weight(1f))
            DeliveryTab.Active -> when {
                deliveriesShowsOffers(availability) -> OffersScreen(
                    onAccepted = onAccepted,
                    inShell = true,
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
private fun DeliveryTabs(
    selected: DeliveryTab,
    onSelect: (DeliveryTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        DeliveryTab.entries.forEach { tab ->
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
                    if (tab == DeliveryTab.Active) "Active" else "History",
                    style = RidersType.body.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                    color = if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary,
                )
            }
        }
    }
}
