package com.riders.rider.feature.offers.presentation

import androidx.activity.compose.BackHandler
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
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.offerExpiryLabel
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.offerPriceLabel

@Composable
fun OffersScreen(
    onAccepted: (String) -> Unit,
    inShell: Boolean = false,
    modifier: Modifier = Modifier,
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
    androidx.compose.runtime.LaunchedEffect(ui.accepted?.deliveryId) {
        ui.accepted?.let { onAccepted(it.deliveryId) }
    }
    val selected = ui.selected
    BackHandler(enabled = selected != null) { model.select(null) }
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
            .padding(horizontal = RidersSpacing.xl)
            .padding(bottom = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        if (selected == null) {
            OfferList(ui, onSelect = model::select, onRetry = model::pullRefresh)
        } else {
            OfferDetail(
                offer = selected,
                accepting = ui.accepting,
                unavailable = ui.offerGone,
                nowMillis = ui.nowMillis,
                error = ui.error,
                onAccept = { model.accept(selected) },
                onRetry = model::pullRefresh,
                onBack = { model.select(null) },
            )
        }
    }
    }
}

@Composable
private fun OfferList(ui: OfferUi, onSelect: (OfferResponse) -> Unit, onRetry: () -> Unit) {
    when {
        ui.loading && ui.offers.isEmpty() -> RidersLoadingState("Looking for requests")
        ui.offers.isEmpty() && ui.error != null -> RidersFailureNotice(
            message = ui.error,
            title = "Requests unavailable",
            onRetry = onRetry,
        )
        ui.offers.isEmpty() -> RidersEmptyState(
            title = "No open requests",
            body = "New requests appear here while you stay available.",
            image = R.drawable.parcel_box,
        )
        else -> ui.offers.forEach { offer ->
            val expired = offerIsExpired(offer.expiresAt, ui.nowMillis)
            RidersCard(onClick = { onSelect(offer) }, modifier = Modifier.fillMaxWidth()) {
                Text(offer.parcel.description, style = RidersType.bodyStrong, color = RidersColors.text)
                Text("Offered price", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(offerPriceLabel(offer.currency, offer.offeredPrice), style = RidersType.bodyStrong, color = RidersColors.text)
                Text("Pickup", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(stopLine(offer.pickup.address, offer.pickup.landmark), style = RidersType.body, color = RidersColors.text)
                Text("Drop-off", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(stopLine(offer.dropoff.address, offer.dropoff.landmark), style = RidersType.body, color = RidersColors.text)
                Text(offerExpiryLabel(offer.expiresAt, ui.nowMillis), style = RidersType.caption, color = if (expired) RidersColors.error else RidersColors.textSecondary)
            }
        }
    }
    if (ui.error != null && ui.offers.isNotEmpty()) {
        RidersFailureNotice(message = ui.error, onRetry = onRetry)
    }
}

@Composable
private fun OfferDetail(
    offer: OfferResponse,
    accepting: Boolean,
    unavailable: Boolean,
    nowMillis: Long,
    error: String?,
    onAccept: () -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    val expired = offerIsExpired(offer.expiresAt, nowMillis)
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
        Text("Offered price", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(offerPriceLabel(offer.currency, offer.offeredPrice), style = RidersType.bodyStrong, color = RidersColors.text)
        Text(offerExpiryLabel(offer.expiresAt, nowMillis), style = RidersType.caption, color = if (expired) RidersColors.error else RidersColors.textSecondary)
    }
    if (error != null) {
        RidersFailureNotice(message = error, onRetry = onRetry)
    }
    RidersPrimaryButton(
        label = "Accept",
        onClick = onAccept,
        enabled = canAcceptOffer(offer.expiresAt, nowMillis, accepting, unavailable),
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
