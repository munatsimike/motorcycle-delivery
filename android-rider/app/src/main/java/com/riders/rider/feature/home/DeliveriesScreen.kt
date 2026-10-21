package com.riders.rider.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.offers.presentation.OffersScreen
import com.riders.rider.navigation.deliveriesShowsActiveDelivery
import com.riders.rider.navigation.deliveriesShowsOffers

@Composable
fun DeliveriesScreen(
    onAccepted: (String) -> Unit,
    onOpenDelivery: (String) -> Unit,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val availability = ui.onboarding?.availability
    when {
        deliveriesShowsOffers(availability) -> OffersScreen(onAccepted = onAccepted, inShell = true)
        deliveriesShowsActiveDelivery(availability) -> Column(
            Modifier
                .fillMaxSize()
                .background(RidersColors.background)
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            RidersWordmark()
            Text("Deliveries", style = RidersType.title, color = RidersColors.text)
            ActiveDeliverySection(ui, onOpenDelivery, model::refresh)
        }
        else -> Column(
            Modifier
                .fillMaxSize()
                .background(RidersColors.background)
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            RidersWordmark()
            Text("Deliveries", style = RidersType.title, color = RidersColors.text)
            RidersEmptyState(
                title = "No delivery requests",
                body = ui.readiness?.message ?: "Go online from Home to receive delivery requests.",
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
