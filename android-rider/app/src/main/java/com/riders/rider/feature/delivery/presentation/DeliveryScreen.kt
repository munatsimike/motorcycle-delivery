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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.PhoneWithFlag
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.R
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.delivery.domain.V2CancellationReasons
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
    var choosingCancel by remember(ui.deliveryId) { mutableStateOf(false) }
    var cancelReason by remember(ui.deliveryId) { mutableStateOf<String?>(null) }
    var cancelNote by remember(ui.deliveryId) { mutableStateOf("") }
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.load(deliveryId, fromUser = true) },
        modifier = Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        RidersWordmark()
        Text(ui.title, style = RidersType.title, color = RidersColors.text)
        val serviceClass = ui.serviceClassLabel
        if (serviceClass != null) {
            Text(serviceClass, style = RidersType.captionStrong, color = RidersColors.primaryDark)
        }
        if (ui.statusLabel.isNotBlank()) {
            Text(ui.statusLabel, style = RidersType.captionStrong, color = RidersColors.primaryDark)
        }
        ui.deadlineLabel?.let { label ->
            Text(label, style = RidersType.body, color = RidersColors.textSecondary)
        }
        ui.agreedPriceLabel?.let { label ->
            Text(label, style = RidersType.body, color = RidersColors.text)
        }
        when {
            ui.missing -> RidersEmptyState(
                title = "This delivery is no longer active",
                body = "It has been completed or is no longer assigned to you.",
                image = R.drawable.parcel_box,
                modifier = Modifier.fillMaxWidth(),
            )
            ui.syncing && ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() -> RidersLoadingState("Loading this delivery")
            ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() && ui.error != null -> RidersFailureNotice(
                message = ui.error.orEmpty(),
                title = "Delivery unavailable",
                onRetry = { model.load(deliveryId, fromUser = true) },
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
                    RidersFailureNotice(
                        message = ui.error.orEmpty(),
                        onRetry = { model.load(deliveryId, fromUser = true) },
                    )
                }
                ui.completionMessage?.let { message ->
                    Text(message, style = RidersType.bodyStrong, color = RidersColors.text)
                    RidersPrimaryButton(
                        label = "Back to deliveries",
                        onClick = onFinished,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                ui.cancellationMessage?.let { message ->
                    Text(message, style = RidersType.bodyStrong, color = RidersColors.text)
                    RidersPrimaryButton(
                        label = "Back to deliveries",
                        onClick = onFinished,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (ui.completionMessage == null && ui.cancellationMessage == null && !ui.readOnly) ui.nextLabel?.let { label ->
                    RidersPrimaryButton(
                        label = label,
                        onClick = model::advance,
                        enabled = !blocked,
                        loading = ui.busy == DeliveryBusy.Advance,
                        loadingLabel = label,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (ui.marketplaceParcel && ui.cancelVisible && ui.completionMessage == null && ui.cancellationMessage == null) {
                    CancellationSection(
                        pendingReason = ui.pendingCancelReason,
                        pendingNote = ui.pendingCancelNote,
                        choosing = choosingCancel || ui.pendingCancelReason != null,
                        reason = cancelReason,
                        note = cancelNote,
                        blocked = blocked,
                        cancelling = ui.busy == DeliveryBusy.Release,
                        onChoose = { choosingCancel = true },
                        onReason = { cancelReason = it },
                        onNote = { cancelNote = it },
                        onConfirm = {
                            model.confirmCancellation(
                                ui.pendingCancelReason ?: cancelReason.orEmpty(),
                                ui.pendingCancelNote ?: cancelNote,
                            )
                        },
                    )
                }
                if (!ui.marketplaceParcel && !ui.readOnly && ui.canRelease) {
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
}

@Composable
private fun CancellationSection(
    pendingReason: String?,
    pendingNote: String?,
    choosing: Boolean,
    reason: String?,
    note: String,
    blocked: Boolean,
    cancelling: Boolean,
    onChoose: () -> Unit,
    onReason: (String) -> Unit,
    onNote: (String) -> Unit,
    onConfirm: () -> Unit,
) {
    if (!choosing) {
        RidersSecondaryButton(
            label = "Cancel delivery",
            onClick = onChoose,
            enabled = !blocked,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
        )
        return
    }
    val locked = pendingReason != null
    Text("Cancel this delivery?", style = RidersType.bodyStrong, color = RidersColors.text)
    if (locked) {
        val label = V2CancellationReasons.firstOrNull { it.first == pendingReason }?.second ?: pendingReason
        Text(label, style = RidersType.body, color = RidersColors.text)
        pendingNote?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    } else {
        V2CancellationReasons.forEach { (value, label) ->
            RidersSecondaryButton(
                label = label,
                onClick = { onReason(value) },
                enabled = !blocked,
                modifier = Modifier.fillMaxWidth(),
                soft = reason != value,
            )
        }
        if (reason == "OTHER") {
            RidersTextField(
                label = "Cancellation note",
                value = note,
                onValueChange = onNote,
                enabled = !blocked,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    RidersPrimaryButton(
        label = "Confirm cancellation",
        onClick = onConfirm,
        enabled = !blocked && (locked || reason != null),
        loading = cancelling,
        loadingLabel = "Cancelling delivery",
        modifier = Modifier.fillMaxWidth(),
    )
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
        contactName?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        contactPhone?.takeIf { it.isNotBlank() }?.let {
            PhoneWithFlag(it, style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
}
