package com.riders.rider.feature.delivery.presentation

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.offers.domain.ReleaseReasons

@Composable
fun DeliveryScreen(
    deliveryId: String,
    onFinished: () -> Unit,
    model: DeliveryViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    DisposableEffect(lifecycle, deliveryId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.load(deliveryId)
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    androidx.compose.runtime.LaunchedEffect(ui.finished) {
        if (ui.finished) {
            onFinished()
        }
    }
    val blocked = ui.syncing || ui.busy != DeliveryBusy.None
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
        Text(ui.title, style = RidersType.title, color = RidersColors.text)
        if (ui.statusLabel.isNotBlank()) {
            Text(ui.statusLabel, style = RidersType.captionStrong, color = RidersColors.primaryDark)
        }
        when {
            ui.syncing && ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() -> RidersLoadingState("Loading this delivery")
            ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() && ui.error != null -> RidersErrorState(
                title = "Delivery unavailable",
                message = ui.error.orEmpty(),
                retryLabel = "Refresh",
                onRetry = { model.load(deliveryId) },
            )
            else -> {
                ParcelCard(ui)
                StopCard(
                    title = "Pickup",
                    address = ui.pickupAddress,
                    landmark = ui.pickupLandmark,
                    instructions = ui.pickupInstructions,
                    contactName = ui.contacts?.pickupName,
                    contactPhone = ui.contacts?.pickupPhone,
                )
                StopCard(
                    title = "Drop-off",
                    address = ui.dropoffAddress,
                    landmark = ui.dropoffLandmark,
                    instructions = ui.dropoffInstructions,
                    contactName = ui.contacts?.dropoffName,
                    contactPhone = ui.contacts?.dropoffPhone,
                )
                val target = navigationTarget(
                    status = ui.status,
                    contacts = ui.contacts,
                    pickupAddress = ui.pickupAddress,
                    pickupLandmark = ui.pickupLandmark,
                    dropoffAddress = ui.dropoffAddress,
                    dropoffLandmark = ui.dropoffLandmark,
                )
                if (target != null) {
                    RidersSecondaryButton(
                        label = "Open in maps",
                        onClick = {
                            val opened = runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target.uri)))
                            }.isSuccess
                            if (!opened) {
                                model.reportNavigationFailure()
                            }
                        },
                        enabled = !blocked,
                        modifier = Modifier.fillMaxWidth(),
                        soft = false,
                    )
                }
                if (ui.error != null) {
                    RidersErrorState(message = ui.error.orEmpty(), retryLabel = "Refresh", onRetry = { model.load(deliveryId) })
                }
                ui.nextLabel?.let { label ->
                    RidersPrimaryButton(
                        label = label,
                        onClick = model::advance,
                        enabled = !blocked,
                        loading = ui.busy == DeliveryBusy.Advance,
                        loadingLabel = label,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (ui.canRelease) {
                    ReleaseReasons.forEach { (reason, label) ->
                        RidersSecondaryButton(
                            label = label,
                            onClick = { model.release(reason) },
                            enabled = !blocked,
                            loading = ui.busy == DeliveryBusy.Release,
                            modifier = Modifier.fillMaxWidth(),
                            soft = false,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ParcelCard(ui: DeliveryUi) {
    if (ui.parcelDescription.isBlank() && ui.parcelSize.isBlank()) {
        return
    }
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Parcel", style = RidersType.caption, color = RidersColors.textSecondary)
        if (ui.parcelDescription.isNotBlank()) {
            Text(ui.parcelDescription, style = RidersType.bodyStrong, color = RidersColors.text)
        }
        if (ui.parcelSize.isNotBlank()) {
            Text("Size ${ui.parcelSize}", style = RidersType.body, color = RidersColors.text)
        }
        ui.parcelInstructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
}

@Composable
private fun StopCard(
    title: String,
    address: String,
    landmark: String?,
    instructions: String?,
    contactName: String?,
    contactPhone: String?,
) {
    if (address.isBlank() && landmark.isNullOrBlank()) {
        return
    }
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text(title, style = RidersType.caption, color = RidersColors.textSecondary)
        if (address.isNotBlank()) {
            Text(address, style = RidersType.body, color = RidersColors.text)
        }
        landmark?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.body, color = RidersColors.text)
        }
        instructions?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        contactLine(contactName, contactPhone)?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
}

private fun contactLine(name: String?, phone: String?): String? {
    val person = name?.takeIf { it.isNotBlank() }
    val number = phone?.takeIf { it.isNotBlank() }
    return when {
        person != null && number != null -> "$person, $number"
        person != null -> person
        else -> number
    }
}
