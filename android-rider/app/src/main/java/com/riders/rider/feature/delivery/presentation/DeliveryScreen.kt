package com.riders.rider.feature.delivery.presentation

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.R
import com.riders.rider.core.design.RidersButtonTone
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.V2CancellationReasons
import com.riders.rider.feature.delivery.domain.navigationActionLabel
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.showsRecipientOnDelivery
import com.riders.rider.feature.delivery.domain.riderDetailsHeading
import com.riders.rider.feature.delivery.domain.riderDetailsSupport

@Composable
fun DeliveryScreen(
    deliveryId: String,
    onFinished: () -> Unit,
    onBack: () -> Unit = onFinished,
    completed: Boolean = false,
    model: DeliveryViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    var detailsOpen by remember(ui.deliveryId) { mutableStateOf(false) }
    var choosingCancel by remember(ui.deliveryId) { mutableStateOf(false) }
    var confirmAction by remember(ui.deliveryId, ui.status) { mutableStateOf<String?>(null) }
    var cancelReason by remember(ui.deliveryId) { mutableStateOf<String?>(null) }
    var cancelNote by remember(ui.deliveryId) { mutableStateOf("") }
    DisposableEffect(lifecycle, deliveryId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.load(deliveryId, completed = completed)
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
    androidx.compose.runtime.LaunchedEffect(ui.pendingCancelReason) {
        if (ui.pendingCancelReason != null) {
            detailsOpen = true
        }
    }
    androidx.compose.runtime.LaunchedEffect(ui.cancellationMessage, ui.completionMessage) {
        if (ui.cancellationMessage != null || ui.completionMessage != null) {
            detailsOpen = false
        }
    }
    val blocked = ui.syncing || ui.busy != DeliveryBusy.None
    Box(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.load(deliveryId, fromUser = true, completed = completed) },
        modifier = Modifier.fillMaxSize(),
    ) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        when {
            ui.missing -> RidersEmptyState(
                title = "This delivery is no longer active",
                body = "It has been completed or is no longer assigned to you.",
                image = R.drawable.parcel_box,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(RidersSpacing.lg),
            )
            ui.syncing && ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() -> RidersLoadingState(
                "Loading this delivery",
                modifier = Modifier.padding(RidersSpacing.lg),
            )
            ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() && ui.error != null -> RidersFailureNotice(
                message = ui.error.orEmpty(),
                title = "Delivery unavailable",
                onRetry = { model.load(deliveryId, fromUser = true, completed = completed) },
                modifier = Modifier.padding(RidersSpacing.lg),
            )
            else -> {
                DeliveryStatusHero(ui.status)
                Column(
                    Modifier
                        .padding(horizontal = RidersSpacing.lg)
                        .padding(bottom = RidersSpacing.lg),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                ) {
                if (ui.status != "DELIVERED") {
                    val recipient = showsRecipientOnDelivery(ui.status)
                    PartyContact(
                        role = if (recipient) "Recipient" else "Sender",
                        name = if (recipient) ui.contacts?.dropoffName.orEmpty() else ui.contacts?.pickupName.orEmpty(),
                        phone = if (recipient) ui.contacts?.dropoffPhone.orEmpty() else ui.contacts?.pickupPhone.orEmpty(),
                        address = if (recipient) ui.dropoffAddress else ui.pickupAddress,
                    )
                }
                val target = navigationTarget(
                    status = ui.status,
                    contacts = ui.contacts,
                    pickupAddress = ui.pickupAddress,
                    pickupLandmark = ui.pickupLandmark,
                    dropoffAddress = ui.dropoffAddress,
                    dropoffLandmark = ui.dropoffLandmark,
                )
                if (ui.marketplaceParcel && ui.nextLabel != null && target != null) {
                    RidersSecondaryButton(
                        label = navigationActionLabel(ui.status) ?: "Open in maps",
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
                        onRetry = { model.load(deliveryId, fromUser = true, completed = completed) },
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
                if (ui.marketplaceParcel && ui.completionMessage == null && ui.cancellationMessage == null && !ui.readOnly) ui.nextLabel?.let { label ->
                    RidersPrimaryButton(
                        label = label,
                        onClick = {
                            if (label == "Confirm pickup" || label == "Mark as delivered") {
                                confirmAction = label
                            }
                        },
                        enabled = !blocked,
                        loading = ui.busy == DeliveryBusy.Advance,
                        loadingLabel = label,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (ui.status == "DELIVERED") {
                    DeliveryDetailsSummary(
                        description = ui.parcelDescription,
                        serviceClass = ui.serviceClass,
                        deliveryId = ui.deliveryId,
                        createdAt = ui.createdAt,
                        dateCaption = if (ui.completedAt != null) "Completed" else "Date",
                        pickup = ui.pickupAddress,
                        dropoff = ui.dropoffAddress,
                        distanceMeters = ui.distanceMeters,
                        price = ui.agreedPrice,
                        modifier = Modifier.fillMaxWidth(),
                        pickupContact = { StopContactLine(ui, sender = true) },
                        dropoffContact = { StopContactLine(ui, sender = false) },
                        pickupDetail = { StopNotes(ui.pickupLandmark, ui.pickupInstructions) },
                        dropoffDetail = { StopNotes(ui.dropoffLandmark, ui.dropoffInstructions) },
                    )
                } else {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            Modifier.clickable(role = Role.Button, onClick = { detailsOpen = true }),
                            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Parcel details",
                                style = RidersType.button.copy(fontWeight = FontWeight.Medium),
                                color = RidersColors.primary,
                            )
                            Icon(
                                painter = painterResource(R.drawable.ic_chevron_up),
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = RidersColors.primary,
                            )
                        }
                    }
                }
                }
            }
        }
    }
    }
    if (!ui.missing) {
        ParcelDetailsSheet(
            visible = detailsOpen,
            ui = ui,
            blocked = blocked,
            choosingCancel = choosingCancel || ui.pendingCancelReason != null,
            cancelReason = cancelReason,
            cancelNote = cancelNote,
            onDismiss = { detailsOpen = false },
            onChooseCancel = { choosingCancel = true },
            onCancelReason = { cancelReason = it },
            onCancelNote = { cancelNote = it },
            onConfirmCancel = {
                model.confirmCancellation(
                    ui.pendingCancelReason ?: cancelReason.orEmpty(),
                    ui.pendingCancelNote ?: cancelNote,
                )
            },
        )
    }
    confirmAction?.let { action ->
        val pickup = action == "Confirm pickup"
        AlertDialog(
            onDismissRequest = { confirmAction = null },
            title = { Text(if (pickup) "Confirm parcel pickup?" else "Confirm delivery?") },
            text = { Text(if (pickup) "Have you collected the parcel from the sender?" else "Have you handed the parcel to the recipient?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmAction = null
                    model.advance()
                }) { Text(if (pickup) "Yes, collected" else "Yes, delivered") }
            },
            dismissButton = {
                TextButton(onClick = { confirmAction = null }) { Text("Not yet") }
            },
        )
    }
    Icon(
        painter = painterResource(R.drawable.ic_chevron_left),
        contentDescription = "Back",
        modifier = Modifier
            .align(Alignment.TopStart)
            .padding(start = RidersSpacing.md, top = RidersSpacing.sm)
            .size(28.dp)
            .clickable(role = Role.Button, onClick = onBack),
        tint = RidersColors.text,
    )
    }
}

@Composable
private fun ParcelDetailsSheet(
    visible: Boolean,
    ui: DeliveryUi,
    blocked: Boolean,
    choosingCancel: Boolean,
    cancelReason: String?,
    cancelNote: String,
    onDismiss: () -> Unit,
    onChooseCancel: () -> Unit,
    onCancelReason: (String) -> Unit,
    onCancelNote: (String) -> Unit,
    onConfirmCancel: () -> Unit,
) {
    RidersBottomSheet(visible = visible, onDismiss = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            DeliveryDetailsSummary(
                description = ui.parcelDescription,
                serviceClass = ui.serviceClass,
                deliveryId = ui.deliveryId,
                createdAt = ui.createdAt,
                pickup = ui.pickupAddress,
                dropoff = ui.dropoffAddress,
                distanceMeters = ui.distanceMeters,
                price = ui.agreedPrice,
                modifier = Modifier.fillMaxWidth(),
                framed = false,
                pickupContact = { StopContactLine(ui, sender = true) },
                dropoffContact = { StopContactLine(ui, sender = false) },
                pickupDetail = { StopNotes(ui.pickupLandmark, ui.pickupInstructions) },
                dropoffDetail = { StopNotes(ui.dropoffLandmark, ui.dropoffInstructions) },
            )
            if (ui.marketplaceParcel && ui.cancelVisible && ui.completionMessage == null && ui.cancellationMessage == null) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(
                            Brush.horizontalGradient(
                                listOf(Color.Transparent, RidersColors.border, Color.Transparent),
                            ),
                        ),
                )
                CancellationSection(
                    pendingReason = ui.pendingCancelReason,
                    pendingNote = ui.pendingCancelNote,
                    choosing = choosingCancel,
                    reason = cancelReason,
                    note = cancelNote,
                    blocked = blocked,
                    cancelling = ui.busy == DeliveryBusy.Release,
                    onChoose = onChooseCancel,
                    onReason = onCancelReason,
                    onNote = onCancelNote,
                    onConfirm = onConfirmCancel,
                )
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
            tone = RidersButtonTone.Danger,
            soft = false,
            bordered = false,
        )
        return
    }
    val locked = pendingReason != null
    Text("Cancel this delivery?", style = RidersType.bodyStrong, color = RidersColors.text)
    Text(
        "If this request is still open, it becomes available to other riders. A previous offer does not become active again.",
        style = RidersType.caption,
        color = RidersColors.textSecondary,
    )
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
private fun DeliveryStatusHero(status: String) {
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().clipToBounds()) {
            DeliveryGreenBackdrop(Modifier.matchParentSize())
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(top = RidersSpacing.md, bottom = RidersSpacing.xs),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                Box(
                    Modifier
                        .padding(top = RidersSpacing.sm)
                        .size(64.dp)
                        .clip(RoundedCornerShape(RidersRadius.md))
                        .background(RidersColors.background),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_nav_deliveries),
                        contentDescription = null,
                        tint = RidersColors.primaryDark,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Text(
                    riderDetailsHeading(status),
                    style = RidersType.heading.copy(fontWeight = FontWeight.Bold),
                    color = RidersColors.text,
                    textAlign = TextAlign.Center,
                )
                Text(
                    riderDetailsSupport(status),
                    style = RidersType.body,
                    color = RidersColors.textSecondary,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(RidersSpacing.sm)
                .background(Brush.verticalGradient(listOf(Color(0xFFF7FCF9), RidersColors.background))),
        )
    }
}

@Composable
private fun DeliveryGreenBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(0.dp))) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color(0xFFC9EFD9),
                        0.62f to Color(0xFFE5F7EE),
                        1f to Color(0xFFF7FCF9),
                    ),
                ),
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 50.dp, y = (-90).dp)
                .size(220.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.45f)),
        )
        Box(
            Modifier
                .align(Alignment.BottomStart)
                .offset(x = (-120).dp, y = 560.dp)
                .size(720.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.55f)),
        )
    }
}

@Composable
private fun StopContactLine(ui: DeliveryUi, sender: Boolean) {
    val callable = ui.status != "DELIVERED"
    if (sender) {
        StopContactName(
            name = ui.contacts?.pickupName.orEmpty(),
            phone = ui.contacts?.pickupPhone.orEmpty(),
            actions = callable,
        )
    } else {
        StopContactName(
            name = ui.contacts?.dropoffName.orEmpty(),
            phone = ui.contacts?.dropoffPhone.orEmpty(),
            actions = callable,
        )
    }
}

@Composable
private fun StopNotes(
    landmark: String?,
    instructions: String?,
) {
    landmark?.takeIf { it.isNotBlank() }?.let {
        Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
    }
    instructions?.takeIf { it.isNotBlank() }?.let {
        Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
    }
}
