package com.riders.rider.feature.offers.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.Modifier
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired

@Composable
fun OffersScreen(
    onAccepted: (String) -> Unit,
    model: OfferViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.refresh()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    androidx.compose.runtime.LaunchedEffect(ui.accepted?.deliveryId) {
        ui.accepted?.let { onAccepted(it.deliveryId) }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        RidersWordmark()
        Text("Delivery requests", style = RidersType.title, color = RidersColors.text)
        val selected = ui.selected
        if (selected == null) {
            OfferList(ui, onSelect = model::select, onRefresh = model::refresh)
        } else {
            OfferDetail(selected, ui.accepting, ui.error, onAccept = { model.accept(selected) }, onBack = { model.select(null) })
        }
    }
}

@Composable
private fun OfferList(ui: OfferUi, onSelect: (OfferResponse) -> Unit, onRefresh: () -> Unit) {
    when {
        ui.loading && ui.offers.isEmpty() -> RidersLoadingState("Looking for requests")
        ui.offers.isEmpty() && ui.error != null -> RidersErrorState(
            title = "Requests unavailable",
            message = ui.error,
            retryLabel = "Refresh",
            onRetry = onRefresh,
        )
        ui.offers.isEmpty() -> RidersEmptyState(
            title = "No open requests",
            body = "New requests appear here while you stay available. Refresh when you are ready to check again.",
        )
        else -> ui.offers.forEach { offer ->
            val expired = offerIsExpired(offer.expiresAt, System.currentTimeMillis())
            RidersCard(onClick = { onSelect(offer) }, modifier = Modifier.fillMaxWidth()) {
                Text(offer.parcel.description, style = RidersType.bodyStrong, color = RidersColors.text)
                Text("Pickup", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(stopLine(offer.pickup.address, offer.pickup.landmark), style = RidersType.body, color = RidersColors.text)
                Text("Drop-off", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(stopLine(offer.dropoff.address, offer.dropoff.landmark), style = RidersType.body, color = RidersColors.text)
                Text(offerExpiryLabel(offer.expiresAt, System.currentTimeMillis()), style = RidersType.caption, color = if (expired) RidersColors.error else RidersColors.textSecondary)
            }
        }
    }
    if (ui.error != null && ui.offers.isNotEmpty()) {
        RidersErrorState(message = ui.error, retryLabel = "Refresh", onRetry = onRefresh)
    }
    if (ui.offers.isNotEmpty() || ui.error == null) {
        RidersSecondaryButton(label = "Refresh", onClick = onRefresh, enabled = !ui.loading, modifier = Modifier.fillMaxWidth(), soft = false)
    }
}

@Composable
private fun OfferDetail(
    offer: OfferResponse,
    accepting: Boolean,
    error: String?,
    onAccept: () -> Unit,
    onBack: () -> Unit,
) {
    val expired = offerIsExpired(offer.expiresAt, System.currentTimeMillis())
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text(offer.parcel.description, style = RidersType.heading, color = RidersColors.text)
        Text("Size ${offer.parcel.size}", style = RidersType.body, color = RidersColors.text)
        offer.parcel.instructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        Text("Pickup", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(stopLine(offer.pickup.address, offer.pickup.landmark), style = RidersType.body, color = RidersColors.text)
        Text("Drop-off", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(stopLine(offer.dropoff.address, offer.dropoff.landmark), style = RidersType.body, color = RidersColors.text)
        Text("${offer.currency} ${offer.offeredPrice}", style = RidersType.bodyStrong, color = RidersColors.text)
        Text(offerExpiryLabel(offer.expiresAt, System.currentTimeMillis()), style = RidersType.caption, color = if (expired) RidersColors.error else RidersColors.textSecondary)
    }
    if (error != null) {
        RidersErrorState(message = error)
    }
    RidersPrimaryButton(
        label = "Accept",
        onClick = onAccept,
        enabled = !accepting && !expired,
        loading = accepting,
        loadingLabel = "Accepting",
        modifier = Modifier.fillMaxWidth(),
    )
    RidersSecondaryButton(label = "Back", onClick = onBack, modifier = Modifier.fillMaxWidth(), soft = false)
}

private fun stopLine(address: String, landmark: String?): String {
    val place = landmark?.takeIf { it.isNotBlank() } ?: return address
    return "$address, $place"
}
