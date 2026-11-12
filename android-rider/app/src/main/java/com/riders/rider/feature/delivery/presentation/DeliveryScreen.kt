package com.riders.rider.feature.delivery.presentation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import android.graphics.drawable.ColorDrawable
import android.view.ViewGroup
import android.view.WindowManager
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogActions
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTextButton
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersDialogTone
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.R
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.CollectedPrimaryAction
import com.riders.rider.feature.delivery.domain.collectedPrimaryAction
import com.riders.rider.feature.delivery.domain.distinctStopDetail
import com.riders.rider.feature.delivery.domain.riderCancelReasonChoices
import com.riders.rider.feature.delivery.domain.navigationActionLabel
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.showsRecipientOnDelivery
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.riderDetailsHeading
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.domain.deliveryCardAddress
import com.riders.rider.feature.offers.presentation.DeliveredDestinationMap
import com.riders.rider.feature.offers.presentation.RequestRouteMap
import com.riders.rider.feature.delivery.domain.riderDetailsSupport

@Composable
fun DeliveryScreen(
    deliveryId: String,
    onFinished: () -> Unit,
    onBack: () -> Unit = onFinished,
    completed: Boolean = false,
    model: DeliveryViewModel = hiltViewModel(),
    mapModel: CollectionMapModel = hiltViewModel(),
    routeModel: CollectedRouteModel = hiltViewModel(),
    guidanceModel: TurnByTurnModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val riderArrived by mapModel.arrived.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var detailsOpen by remember(ui.deliveryId) { mutableStateOf(false) }
    var cancelOpen by remember(ui.deliveryId) { mutableStateOf(false) }
    var confirmAction by remember(ui.deliveryId, ui.status) { mutableStateOf<String?>(null) }
    var cancelReason by remember(ui.deliveryId) { mutableStateOf<String?>(null) }
    var guidance by remember { mutableStateOf<GuidanceTarget?>(null) }
    var destinationNote by remember(ui.deliveryId, ui.status) { mutableStateOf<String?>(null) }
    BackHandler(enabled = guidance != null) { guidance = null }
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
        val pending = ui.pendingCancelReason
        if (pending != null) {
            cancelReason = pending
            cancelOpen = true
        }
    }
    androidx.compose.runtime.LaunchedEffect(ui.cancellationMessage, ui.completionMessage) {
        if (ui.cancellationMessage != null || ui.completionMessage != null) {
            detailsOpen = false
            cancelOpen = false
        }
    }
    val blocked = ui.syncing || ui.busy != DeliveryBusy.None
    val statusTop = with(LocalDensity.current) { WindowInsets.statusBars.getTop(this).toDp() }
    val navigationBottom = with(LocalDensity.current) { WindowInsets.navigationBars.getBottom(this).toDp() }
    val pickupPoint = parseGeoPoint(ui.contacts?.pickupLatitude, ui.contacts?.pickupLongitude)
    val dropoffPoint = parseGeoPoint(ui.contacts?.dropoffLatitude, ui.contacts?.dropoffLongitude)
    val collectionMap = readyForCollection(ui.status) && pickupPoint != null
    val collected = ui.status == "COLLECTED"
    val drivingMap = (collected || ui.status == "OUT_FOR_DELIVERY") && (pickupPoint != null || dropoffPoint != null)
    androidx.compose.runtime.LaunchedEffect(ui.assignmentId, pickupPoint, dropoffPoint, drivingMap) {
        if (drivingMap) {
            routeModel.load(ui.assignmentId, pickupPoint, dropoffPoint)
        }
    }
    androidx.compose.runtime.DisposableEffect(collected, ui.assignmentId, dropoffPoint, guidance) {
        if (guidance == null && collected && dropoffPoint != null) {
            routeModel.follow(ui.assignmentId, dropoffPoint)
        } else {
            routeModel.stopFollowing()
        }
        onDispose { routeModel.stopFollowing() }
    }
    androidx.compose.runtime.LaunchedEffect(guidance) {
        val active = guidance
        if (active == null) {
            guidanceModel.stop()
        } else {
            guidanceModel.start(active)
        }
    }
    DisposableEffect(guidanceModel) {
        onDispose { guidanceModel.stop() }
    }
    val riderFix = if (collected) routeModel.rider else null
    val riderPoint = riderFix?.let { GeoPoint(it.latitude, it.longitude) }
    val mapHeight = if (collected) 480.dp else 360.dp
    val sheetTop = if (collected) 400.dp else 280.dp
    val headerHeight = statusTop + mapHeight
    val sheetShape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
    val startGuidance = {
        val dropoffLeg = showsRecipientOnDelivery(ui.status)
        val point = if (dropoffLeg) dropoffPoint else pickupPoint
        if (point == null) {
            destinationNote = "This stop has no map location yet."
        } else if (ui.assignmentId.isBlank()) {
            destinationNote = "This delivery is not ready for navigation yet."
        } else {
            destinationNote = null
            guidance = GuidanceTarget(ui.assignmentId, point, dropoffLeg)
        }
    }
    val activeGuidance = guidance
    if (activeGuidance != null) {
        TurnByTurnScreen(
            destination = activeGuidance.destination,
            dropoff = activeGuidance.dropoff,
            onExit = { guidance = null },
            model = guidanceModel,
        )
        return
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFFF7FCF9)),
    ) {
    if (collectionMap) {
        CollectionMapPage(
            ui = ui,
            riderArrived = riderArrived,
            blocked = blocked,
            model = model,
            onBack = onBack,
            onFinished = onFinished,
            onConfirm = { confirmAction = it },
            onOpenDetails = { detailsOpen = true },
            onStartCancel = { cancelOpen = true },
            navigationBottom = navigationBottom,
            onNavigate = startGuidance,
            destinationNote = destinationNote,
        )
    } else if (ui.status == "DELIVERED") {
        DeliveredPage(
            ui = ui,
            onBack = onBack,
            navigationBottom = navigationBottom,
        )
    } else if (collected) {
        RidersPullRefresh(
            refreshing = ui.refreshing,
            onRefresh = { model.load(deliveryId, fromUser = true, completed = completed) },
            modifier = Modifier.fillMaxSize(),
        ) {
            CollectedPage(
                ui = ui,
                deliveryId = deliveryId,
                riderArrived = riderArrived,
                blocked = blocked,
                model = model,
                routeModel = routeModel,
                pickupPoint = pickupPoint,
                dropoffPoint = dropoffPoint,
                onBack = onBack,
                onFinished = onFinished,
                onConfirm = { confirmAction = it },
                onOpenDetails = { detailsOpen = true },
                onStartCancel = { cancelOpen = true },
                navigationBottom = navigationBottom,
                statusTop = statusTop,
                completed = completed,
                onNavigate = startGuidance,
                destinationNote = destinationNote,
            )
        }
    } else {
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.load(deliveryId, fromUser = true, completed = completed) },
        modifier = Modifier.fillMaxSize(),
    ) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val sheetFloor = (maxHeight - statusTop - sheetTop).coerceAtLeast(0.dp)
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Box(Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(headerHeight)
                    .clipToBounds(),
            ) {
                    if (drivingMap) {
                        RequestRouteMap(
                            deliveryId = deliveryId,
                            pickup = pickupPoint,
                            dropoff = dropoffPoint,
                            line = if (riderPoint != null) routeModel.liveLine else routeModel.line,
                            modifier = Modifier.fillMaxSize(),
                            sheetOverlap = mapHeight - sheetTop,
                            rider = riderPoint,
                            waitingForLocation = collected && riderPoint == null,
                            routeWidth = 4.dp,
                        )
                    } else {
                        MapBackground(
                            Modifier.fillMaxSize(),
                            pickup = pickupPoint,
                            dropoff = dropoffPoint,
                        )
                        Box(
                            Modifier
                                .matchParentSize()
                                .background(
                                    Brush.verticalGradient(
                                        0f to Color(0xFFC9EFD9).copy(alpha = 0.72f),
                                        0.62f to Color(0xFFE5F7EE).copy(alpha = 0.35f),
                                        1f to Color(0xFFF7FCF9).copy(alpha = 0.55f),
                                    ),
                                ),
                        )
                    }
                if (collected) {
                    Box(
                        Modifier
                            .statusBarsPadding()
                            .padding(start = RidersSpacing.lg, top = RidersSpacing.md)
                            .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .clickable(role = Role.Button, onClick = onBack),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.ic_chevron_left),
                            contentDescription = "Back",
                            tint = RidersColors.text,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                } else {
                    Icon(
                        painter = painterResource(R.drawable.ic_chevron_left),
                        contentDescription = "Back",
                        modifier = Modifier
                            .statusBarsPadding()
                            .padding(start = RidersSpacing.lg, top = RidersSpacing.md)
                            .size(28.dp)
                            .clickable(role = Role.Button, onClick = onBack),
                        tint = RidersColors.text,
                    )
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = statusTop + sheetTop)
                    .then(if (collected) Modifier else Modifier.heightIn(min = sheetFloor))
                    .clip(sheetShape)
                    .background(RidersColors.background)
                    .padding(
                        top = when {
                            ui.status == "DELIVERED" -> RidersSpacing.sm
                            collected -> RidersSpacing.md
                            else -> RidersSpacing.xl
                        },
                        bottom = RidersSpacing.lg + navigationBottom,
                    ),
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
                Column(Modifier.fillMaxWidth()) {
                DeliveryStatusHero(ui.status, ui.dropoffAddress, ui.pickupAddress)
                DeliveryActionBlock(
                    ui = ui,
                    riderArrived = riderArrived,
                    blocked = blocked,
                    model = model,
                    onFinished = onFinished,
                    onConfirm = { confirmAction = it },
                    onOpenDetails = { detailsOpen = true },
                    onStartCancel = { cancelOpen = true },
                    completed = completed,
                    onNavigate = startGuidance,
                    destinationNote = destinationNote,
                )
            }
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
            onDismiss = { detailsOpen = false },
        )
        CancelDeliveryModal(
            visible = cancelOpen,
            selectedReason = ui.pendingCancelReason ?: cancelReason,
            submitting = ui.busy == DeliveryBusy.Release,
            error = ui.error,
            onSelect = { reason ->
                if (ui.pendingCancelReason == null) {
                    cancelReason = reason
                }
            },
            onConfirm = {
                val reason = ui.pendingCancelReason ?: cancelReason
                if (reason != null) {
                    model.confirmCancellation(reason, ui.pendingCancelNote.orEmpty())
                }
            },
            onDismiss = {
                if (ui.busy != DeliveryBusy.Release) {
                    cancelOpen = false
                    if (ui.pendingCancelReason == null) {
                        cancelReason = null
                    }
                }
            },
        )
    }
    confirmAction?.let { action ->
        val pickup = action == "Confirm pickup"
        RidersDialog(visible = true, onDismiss = { confirmAction = null }) {
            RidersDialogTitle(if (pickup) "Confirm parcel pickup?" else "Confirm delivery?")
            RidersDialogBody(if (pickup) "Have you collected the parcel from the sender?" else "Have you handed the parcel to the recipient?")
            RidersDialogActions {
                RidersDialogTextButton(
                    label = "Not yet",
                    tone = RidersDialogTone.Neutral,
                    onClick = { confirmAction = null },
                )
                RidersDialogTextButton(
                    label = if (pickup) "Yes, collected" else "Yes, delivered",
                    onClick = {
                        confirmAction = null
                        model.advance()
                    },
                )
            }
        }
    }
    }
}

@Composable
private fun CollectionMapPage(
    ui: DeliveryUi,
    riderArrived: Boolean,
    blocked: Boolean,
    model: DeliveryViewModel,
    onBack: () -> Unit,
    onFinished: () -> Unit,
    onConfirm: (String) -> Unit,
    onOpenDetails: () -> Unit,
    onStartCancel: () -> Unit,
    navigationBottom: Dp,
    onNavigate: () -> Unit,
    destinationNote: String?,
) {
    val density = LocalDensity.current
    val cardShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    var sheetHeight by remember { mutableStateOf(0.dp) }
    Box(Modifier.fillMaxSize()) {
        CollectionMap(
            assignmentId = ui.assignmentId,
            pickupLatitude = ui.contacts?.pickupLatitude,
            pickupLongitude = ui.contacts?.pickupLongitude,
            sheetOverlap = sheetHeight,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier
                .statusBarsPadding()
                .padding(start = RidersSpacing.lg, top = RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color.White)
                .clickable(role = Role.Button, onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_left),
                contentDescription = "Back",
                tint = RidersColors.text,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } }
                .shadow(12.dp, cardShape, clip = false, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .background(RidersColors.background, cardShape)
                .clip(cardShape)
                .padding(
                    start = RidersSpacing.lg,
                    top = RidersSpacing.sm,
                    end = RidersSpacing.lg,
                    bottom = RidersSpacing.lg + navigationBottom,
                ),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = RidersSpacing.xs, bottom = RidersSpacing.xs)
                    .width(36.dp)
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(RidersColors.border),
            )
            when {
                ui.missing -> RidersEmptyState(
                    title = "This delivery is no longer active",
                    body = "It has been completed or is no longer assigned to you.",
                    image = R.drawable.parcel_box,
                    modifier = Modifier.fillMaxWidth(),
                )
                ui.syncing && ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() -> RidersLoadingState(
                    "Loading this delivery",
                )
                ui.pickupAddress.isBlank() && ui.parcelDescription.isBlank() && ui.error != null -> RidersFailureNotice(
                    message = ui.error,
                    title = "Delivery unavailable",
                    onRetry = { model.load(ui.deliveryId, fromUser = true) },
                )
                else -> {
                    Column(Modifier.fillMaxWidth()) {
                        CollectionSheetHeader(ui)
                        Spacer(Modifier.height(16.dp))
                        DeliveryActionBlock(
                            ui = ui,
                            riderArrived = riderArrived,
                            blocked = blocked,
                            model = model,
                            onFinished = onFinished,
                            onConfirm = onConfirm,
                            onOpenDetails = onOpenDetails,
                            onStartCancel = onStartCancel,
                            compact = true,
                            onNavigate = onNavigate,
                            destinationNote = destinationNote,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CollectionSheetHeader(ui: DeliveryUi) {
    DeliveryPlaceLine(
        instruction = "Collect the parcel at",
        address = ui.pickupAddress,
        fallback = riderDetailsSupport("RIDER_ASSIGNED"),
    )
}

@Composable
private fun DeliveryActionBlock(
    ui: DeliveryUi,
    riderArrived: Boolean,
    blocked: Boolean,
    model: DeliveryViewModel,
    onFinished: () -> Unit,
    onConfirm: (String) -> Unit,
    onOpenDetails: () -> Unit,
    onStartCancel: () -> Unit,
    compact: Boolean = false,
    completed: Boolean = false,
    atDropoff: Boolean = false,
    locationGranted: Boolean = true,
    onNavigate: () -> Unit,
    destinationNote: String? = null,
) {
    val target = navigationTarget(
        status = ui.status,
        contacts = ui.contacts,
        pickupAddress = ui.pickupAddress,
        pickupLandmark = ui.pickupLandmark,
        dropoffAddress = ui.dropoffAddress,
        dropoffLandmark = ui.dropoffLandmark,
    )
    val collecting = readyForCollection(ui.status) &&
        ui.marketplaceParcel &&
        ui.nextLabel == "Confirm pickup" &&
        ui.completionMessage == null &&
        ui.cancellationMessage == null &&
        !ui.readOnly
    val collected = ui.status == "COLLECTED"
    val stackSpacing = when {
        compact -> RidersSpacing.md
        collected || ui.status == "DELIVERED" -> RidersSpacing.sm
        else -> RidersSpacing.lg
    }
    val partyThenAction = (compact || collected) && ui.status != "DELIVERED"
    val confirmCollected = collected && collectedPrimaryAction(
        arrived = atDropoff,
        dropoffKnown = parseGeoPoint(ui.contacts?.dropoffLatitude, ui.contacts?.dropoffLongitude) != null,
        locationGranted = locationGranted,
    ) == CollectedPrimaryAction.MarkAsDelivered
    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (compact) {
                    Modifier
                } else {
                    Modifier
                        .padding(horizontal = RidersSpacing.lg)
                        .padding(
                            top = when {
                                ui.status == "DELIVERED" -> 0.dp
                                collected -> 16.dp
                                else -> RidersSpacing.lg
                            },
                        )
                },
            ),
        verticalArrangement = if (partyThenAction) {
            Arrangement.Top
        } else {
            Arrangement.spacedBy(stackSpacing)
        },
    ) {
        if (!compact) {
            CollectionActions(
                ui = ui,
                collecting = collecting,
                riderArrived = riderArrived,
                blocked = blocked,
                targetUri = target?.uri,
                onConfirm = onConfirm,
                onNavigate = onNavigate,
                destinationNote = destinationNote,
            )
        }
        if (ui.status != "DELIVERED") {
            val recipient = showsRecipientOnDelivery(ui.status)
            PartyContact(
                role = if (recipient) "Recipient" else "Sender",
                name = if (recipient) ui.contacts?.dropoffName.orEmpty() else ui.contacts?.pickupName.orEmpty(),
                phone = if (recipient) ui.contacts?.dropoffPhone.orEmpty() else ui.contacts?.pickupPhone.orEmpty(),
                address = if (recipient) ui.dropoffAddress else ui.pickupAddress,
                compact = compact,
                tinted = collected && recipient,
                plain = compact || readyForCollection(ui.status) || collected || ui.status == "PICKED_UP",
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = if (partyThenAction) 20.dp else 0.dp),
            verticalArrangement = Arrangement.spacedBy(stackSpacing),
        ) {
        if (compact) {
            CollectionActions(
                ui = ui,
                collecting = collecting,
                riderArrived = riderArrived,
                blocked = blocked,
                targetUri = target?.uri,
                onConfirm = onConfirm,
                onNavigate = onNavigate,
                destinationNote = destinationNote,
            )
        }
        if (!collecting && ui.marketplaceParcel && ui.nextLabel != null && target != null && !confirmCollected) {
            val navigationLabel = navigationActionLabel(ui.status) ?: "Open in maps"
            if (collected) {
                RidersPrimaryButton(
                    label = navigationLabel,
                    onClick = onNavigate,
                    enabled = !blocked,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                RidersSecondaryButton(
                    label = navigationLabel,
                    onClick = onNavigate,
                    enabled = !blocked,
                    modifier = Modifier.fillMaxWidth(),
                    soft = false,
                )
            }
            destinationNote?.let { note ->
                Text(
                    note,
                    style = RidersType.body,
                    color = RidersColors.text,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (ui.error != null) {
            RidersFailureNotice(
                message = ui.error,
                onRetry = { model.load(ui.deliveryId, fromUser = true, completed = completed) },
            )
        }
        ui.completionMessage?.takeUnless { ui.status == "DELIVERED" }?.let { message ->
            Text(
                message,
                style = RidersType.bodyStrong,
                color = RidersColors.text,
                textAlign = TextAlign.Center,
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
        if (!collecting && ui.marketplaceParcel && ui.completionMessage == null && ui.cancellationMessage == null && !ui.readOnly) ui.nextLabel?.let { label ->
            val confirmDelivery = {
                if (label == "Confirm pickup" || label == "Mark as delivered") {
                    onConfirm(label)
                }
            }
            if (collected && label == "Mark as delivered") {
                if (confirmCollected) {
                    RidersPrimaryButton(
                        label = label,
                        onClick = confirmDelivery,
                        enabled = !blocked,
                        loading = ui.busy == DeliveryBusy.Advance,
                        loadingLabel = label,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else {
                RidersPrimaryButton(
                    label = label,
                    onClick = confirmDelivery,
                    enabled = !blocked,
                    loading = ui.busy == DeliveryBusy.Advance,
                    loadingLabel = label,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (ui.status == "DELIVERED") {
            DeliveryDetailsSummary(
                description = ui.parcelDescription,
                serviceClass = ui.serviceClass,
                deliveryId = ui.deliveryId,
                createdAt = ui.createdAt,
                dateCaption = if (ui.completedAt != null) "Completed" else "Date",
                spacious = true,
                pickup = ui.pickupAddress,
                dropoff = ui.dropoffAddress,
                distanceMeters = ui.distanceMeters,
                price = ui.agreedPrice,
                modifier = Modifier.fillMaxWidth(),
                pickupContact = { StopContactLine(ui, sender = true) },
                dropoffContact = { StopContactLine(ui, sender = false) },
                pickupDetail = { StopNotes(ui.pickupAddress, ui.pickupLandmark, ui.pickupInstructions) },
                dropoffDetail = { StopNotes(ui.dropoffAddress, ui.dropoffLandmark, ui.dropoffInstructions) },
            )
        } else {
            val canCancel = readyForCollection(ui.status) &&
                ui.marketplaceParcel &&
                ui.cancelVisible &&
                ui.completionMessage == null &&
                ui.cancellationMessage == null &&
                !ui.readOnly
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = if (collected) 0.dp else RidersSpacing.sm),
                horizontalArrangement = if (canCancel) Arrangement.SpaceBetween else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (canCancel) {
                    Text(
                        "Cancel delivery",
                        style = RidersType.body.copy(fontWeight = FontWeight.Normal),
                        color = RidersColors.error,
                        modifier = Modifier.clickable(role = Role.Button, enabled = !blocked, onClick = onStartCancel),
                    )
                }
                Row(
                    Modifier
                        .then(
                            if (collected) {
                                Modifier.heightIn(min = 48.dp)
                            } else {
                                Modifier.padding(vertical = RidersSpacing.xs)
                            },
                        )
                        .clickable(role = Role.Button, onClick = onOpenDetails),
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Parcel details",
                        style = RidersType.body.copy(fontWeight = FontWeight.Medium),
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

@Composable
private fun CollectionActions(
    ui: DeliveryUi,
    collecting: Boolean,
    riderArrived: Boolean,
    blocked: Boolean,
    targetUri: String?,
    onConfirm: (String) -> Unit,
    onNavigate: () -> Unit,
    destinationNote: String?,
) {
    if (!collecting) {
        return
    }
    if (riderArrived) {
        RidersPrimaryButton(
            label = "Confirm pickup",
            onClick = { onConfirm("Confirm pickup") },
            enabled = !blocked,
            loading = ui.busy == DeliveryBusy.Advance,
            loadingLabel = "Confirm pickup",
            modifier = Modifier.fillMaxWidth(),
        )
    } else if (targetUri != null) {
        RidersPrimaryButton(
            label = "Navigate to pickup",
            onClick = onNavigate,
            enabled = !blocked,
            modifier = Modifier.fillMaxWidth(),
        )
        destinationNote?.let { note ->
            Text(
                note,
                style = RidersType.body,
                color = RidersColors.text,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ParcelDetailsSheet(
    visible: Boolean,
    ui: DeliveryUi,
    onDismiss: () -> Unit,
) {
    RidersBottomSheet(visible = visible, onDismiss = onDismiss) {
        val screenHeight = LocalConfiguration.current.screenHeightDp.dp
        val statusTop = with(LocalDensity.current) { WindowInsets.statusBars.getTop(this).toDp() }
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = (screenHeight - statusTop - 36.dp).coerceAtLeast(0.dp))
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
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
                parcelSheet = true,
                pickupContact = {
                    StopContactLine(ui, sender = true, sheet = true, address = deliveryCardAddress(ui.pickupAddress))
                },
                dropoffContact = {
                    StopContactLine(ui, sender = false, sheet = true, address = deliveryCardAddress(ui.dropoffAddress))
                },
                pickupDetail = { StopNotes(ui.pickupAddress, ui.pickupLandmark, ui.pickupInstructions) },
                dropoffDetail = { StopNotes(ui.dropoffAddress, ui.dropoffLandmark, ui.dropoffInstructions) },
            )
        }
    }
}

@Composable
private fun CancelDeliveryModal(
    visible: Boolean,
    selectedReason: String?,
    submitting: Boolean,
    error: String?,
    onSelect: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    var attempted by remember { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(visible) {
        if (!visible) {
            attempted = false
        }
    }
    if (!visible) {
        return
    }
    val showError = attempted && !submitting && !error.isNullOrBlank()
    val canConfirm = selectedReason != null && !submitting
    val cardShape = RoundedCornerShape(RidersRadius.xl)
    val rowShape = RoundedCornerShape(RidersRadius.lg)
    val maxHeight = LocalConfiguration.current.screenHeightDp.dp - RidersSpacing.xxxl
    Dialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
            dismissOnBackPress = !submitting,
        ),
    ) {
        val view = LocalView.current
        SideEffect {
            val window = (view.parent as? DialogWindowProvider)?.window ?: return@SideEffect
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window.setDimAmount(0f)
            window.setBackgroundDrawable(ColorDrawable(android.graphics.Color.TRANSPARENT))
            WindowCompat.setDecorFitsSystemWindows(window, false)
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        }
        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF17211D).copy(alpha = 0.4f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        enabled = !submitting,
                        onClick = onDismiss,
                    ),
            )
            Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = RidersSpacing.lg)
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .heightIn(max = maxHeight)
                    .clip(cardShape)
                    .background(RidersColors.background)
                    .verticalScroll(rememberScrollState())
                    .padding(RidersSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                    ) {
                        Text("Cancel delivery", style = RidersType.heading, color = RidersColors.text)
                        Text(
                            "Please select a reason for cancellation.",
                            style = RidersType.body,
                            color = RidersColors.textSecondary,
                        )
                    }
                    Icon(
                        painter = painterResource(R.drawable.ic_close),
                        contentDescription = "Close",
                        tint = RidersColors.text,
                        modifier = Modifier
                            .size(40.dp)
                            .clickable(enabled = !submitting, role = Role.Button, onClick = onDismiss)
                            .padding(8.dp),
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
                    riderCancelReasonChoices().forEach { (value, label) ->
                        val selected = value == selectedReason
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(rowShape)
                                .background(if (selected) RidersColors.primaryLight else RidersColors.background)
                                .border(
                                    1.dp,
                                    if (selected) RidersColors.primaryLight else RidersColors.border,
                                    rowShape,
                                )
                                .clickable(enabled = !submitting, role = Role.RadioButton, onClick = { onSelect(value) })
                                .padding(start = RidersSpacing.lg, end = RidersSpacing.sm, top = RidersSpacing.xs, bottom = RidersSpacing.xs),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                label,
                                style = RidersType.body,
                                color = RidersColors.text,
                                modifier = Modifier.weight(1f),
                            )
                            RadioButton(
                                selected = selected,
                                onClick = { if (!submitting) onSelect(value) },
                                enabled = !submitting,
                                colors = RadioButtonDefaults.colors(
                                    selectedColor = RidersColors.primary,
                                    unselectedColor = RidersColors.textSecondary,
                                    disabledSelectedColor = RidersColors.primary,
                                    disabledUnselectedColor = RidersColors.textSecondary,
                                ),
                            )
                        }
                    }
                }
                if (showError) {
                    Text(error.orEmpty(), style = RidersType.caption, color = RidersColors.error)
                    Text(
                        "Retry",
                        style = RidersType.button,
                        color = RidersColors.primary,
                        modifier = Modifier.clickable(enabled = canConfirm, role = Role.Button, onClick = onConfirm),
                    )
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(RidersColors.error.copy(alpha = if (canConfirm) 1f else 0.45f))
                        .clickable(enabled = canConfirm, role = Role.Button) {
                            attempted = true
                            onConfirm()
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    if (submitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            color = RidersColors.textInverse,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Confirm cancellation", style = RidersType.bodyStrong, color = RidersColors.textInverse)
                    }
                }
                Text(
                    "Keep delivery",
                    style = RidersType.button,
                    color = RidersColors.text,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !submitting, role = Role.Button, onClick = onDismiss)
                        .padding(vertical = RidersSpacing.sm),
                )
            }
        }
    }
}

private fun readyForCollection(status: String): Boolean = status == "RIDER_ASSIGNED" ||
    status == "ASSIGNED" ||
    status == "COLLECTING" ||
    status == "ARRIVED_AT_PICKUP"

@Composable
private fun CollectedPage(
    ui: DeliveryUi,
    deliveryId: String,
    riderArrived: Boolean,
    blocked: Boolean,
    model: DeliveryViewModel,
    routeModel: CollectedRouteModel,
    pickupPoint: GeoPoint?,
    dropoffPoint: GeoPoint?,
    onBack: () -> Unit,
    onFinished: () -> Unit,
    onConfirm: (String) -> Unit,
    onOpenDetails: () -> Unit,
    onStartCancel: () -> Unit,
    navigationBottom: Dp,
    statusTop: Dp,
    completed: Boolean,
    onNavigate: () -> Unit,
    destinationNote: String?,
) {
    val density = LocalDensity.current
    val riderPoint = routeModel.rider?.let { GeoPoint(it.latitude, it.longitude) }
    var sheetHeight by remember { mutableStateOf(0.dp) }
    val sheetShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val sheetLimit = (maxHeight - statusTop - 72.dp).coerceAtLeast(0.dp)
        if (pickupPoint != null || dropoffPoint != null) {
            RequestRouteMap(
                deliveryId = deliveryId,
                pickup = pickupPoint,
                dropoff = dropoffPoint,
                line = if (riderPoint != null) routeModel.liveLine else routeModel.line,
                modifier = Modifier.fillMaxSize(),
                sheetOverlap = sheetHeight,
                rider = riderPoint,
                waitingForLocation = riderPoint == null,
                approachLabel = routeModel.approachLabel,
                routeWidth = 4.dp,
            )
        } else {
            MapBackground(Modifier.fillMaxSize(), useKnownLocation = false)
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color(0xFFC9EFD9).copy(alpha = 0.72f),
                            0.62f to Color(0xFFE5F7EE).copy(alpha = 0.35f),
                            1f to Color(0xFFF7FCF9).copy(alpha = 0.55f),
                        ),
                    ),
            )
        }
        Box(
            Modifier
                .statusBarsPadding()
                .padding(start = RidersSpacing.lg, top = RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color.White)
                .clickable(role = Role.Button, onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_left),
                contentDescription = "Back",
                tint = RidersColors.text,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .heightIn(max = sheetLimit)
                .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } }
                .shadow(12.dp, sheetShape, clip = false, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .background(RidersColors.background, sheetShape)
                .clip(sheetShape)
                .padding(top = RidersSpacing.md, bottom = RidersSpacing.lg + navigationBottom),
        ) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
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
                        DeliveryStatusHero(ui.status, ui.dropoffAddress, ui.pickupAddress)
                        DeliveryActionBlock(
                            ui = ui,
                            riderArrived = riderArrived,
                            blocked = blocked,
                            model = model,
                            onFinished = onFinished,
                            onConfirm = onConfirm,
                            onOpenDetails = onOpenDetails,
                            onStartCancel = onStartCancel,
                            completed = completed,
                            atDropoff = routeModel.arrivedAtDropoff,
                            locationGranted = routeModel.locationGranted,
                            onNavigate = onNavigate,
                            destinationNote = destinationNote,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeliveredPage(
    ui: DeliveryUi,
    onBack: () -> Unit,
    navigationBottom: Dp,
) {
    val density = LocalDensity.current
    val dropoff = parseGeoPoint(ui.contacts?.dropoffLatitude, ui.contacts?.dropoffLongitude)
    var sheetHeight by remember { mutableStateOf(0.dp) }
    val sheetShape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
    Box(Modifier.fillMaxSize()) {
        if (dropoff != null) {
            DeliveredDestinationMap(
                point = dropoff,
                recipient = ui.contacts?.dropoffName.orEmpty(),
                address = deliveryCardAddress(ui.dropoffAddress),
                completedAt = ui.completedAt ?: ui.createdAt,
                sheetOverlap = if (sheetHeight > 0.dp) sheetHeight else 240.dp,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            MapBackground(Modifier.fillMaxSize(), useKnownLocation = false)
        }
        Box(
            Modifier
                .statusBarsPadding()
                .padding(start = RidersSpacing.lg, top = RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color.White)
                .clickable(role = Role.Button, onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_left),
                contentDescription = "Back",
                tint = RidersColors.text,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .heightIn(max = 420.dp)
                .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } }
                .shadow(12.dp, sheetShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .clip(sheetShape)
                .background(RidersColors.background),
        ) {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(top = RidersSpacing.md, bottom = navigationBottom),
            ) {
                DeliveryDetailsSummary(
                    description = ui.parcelDescription,
                    serviceClass = ui.serviceClass,
                    deliveryId = ui.deliveryId,
                    createdAt = ui.completedAt ?: ui.createdAt,
                    dateCaption = "Completed",
                    flat = true,
                    spacious = true,
                    pickup = ui.pickupAddress,
                    dropoff = "",
                    distanceMeters = ui.distanceMeters,
                    price = ui.agreedPrice,
                    modifier = Modifier.fillMaxWidth(),
                    pickupContact = {
                        StopContactName(
                            name = ui.contacts?.pickupName.orEmpty(),
                            actions = false,
                        )
                    },
                    pickupDetail = { StopNotes(ui.pickupAddress, ui.pickupLandmark, ui.pickupInstructions) },
                )
            }
        }
    }
}

@Composable
private fun DeliveryStatusHero(status: String, dropoffAddress: String, pickupAddress: String = "") {
    if (status == "DELIVERED") {
        return
    }
    val problem = status == "CANCELLED" || status == "FAILED"
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = RidersSpacing.lg)
            .padding(
                top = when {
                    readyForCollection(status) || status == "COLLECTED" -> RidersSpacing.xs
                    else -> RidersSpacing.lg
                },
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        if (!readyForCollection(status) && status != "COLLECTED") {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (problem) Color(0xFFFDECEC) else RidersColors.primaryLight),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_nav_deliveries),
                    contentDescription = null,
                    tint = if (problem) RidersColors.error else RidersColors.primaryDark,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        val addressLine = status == "COLLECTED" || status == "PICKED_UP" || readyForCollection(status)
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            if (!addressLine) {
                Text(
                    riderDetailsHeading(status),
                    style = RidersType.heading.copy(fontWeight = FontWeight.Bold),
                    color = if (problem) RidersColors.error else RidersColors.text,
                )
            }
            when {
                status == "COLLECTED" || status == "PICKED_UP" -> DeliveryPlaceLine(
                    instruction = "Deliver the parcel to",
                    address = dropoffAddress,
                    fallback = riderDetailsSupport("COLLECTED"),
                )
                readyForCollection(status) -> DeliveryPlaceLine(
                    instruction = "Collect the parcel at",
                    address = pickupAddress,
                    fallback = riderDetailsSupport("RIDER_ASSIGNED"),
                )
                else -> Text(
                    riderDetailsSupport(status),
                    style = RidersType.body,
                    color = RidersColors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun DeliveryPlaceLine(
    instruction: String,
    address: String,
    fallback: String,
) {
    val place = deliveryCardAddress(address).trim()
    if (place.isEmpty()) {
        Text(
            fallback,
            style = RidersType.body.copy(fontSize = 15.sp, lineHeight = 20.sp),
            color = RidersColors.textSecondary,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            instruction,
            style = RidersType.body.copy(fontSize = 15.sp, lineHeight = 20.sp),
            color = RidersColors.textSecondary,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            place,
            style = RidersType.body.copy(fontSize = 19.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
            color = RidersColors.text,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun StopContactLine(ui: DeliveryUi, sender: Boolean, sheet: Boolean = false, address: String = "") {
    val callable = ui.status != "DELIVERED"
    val name = if (sender) ui.contacts?.pickupName.orEmpty() else ui.contacts?.dropoffName.orEmpty()
    val phone = if (sender) ui.contacts?.pickupPhone.orEmpty() else ui.contacts?.dropoffPhone.orEmpty()
    if (ui.status != "DELIVERED" || name.isBlank()) {
        StopContactName(name = name, phone = phone, actions = callable, sheet = sheet, address = address)
        return
    }
    Column(Modifier.fillMaxWidth()) {
        Text(
            if (sender) "SENDER" else "RECIPIENT",
            style = RidersType.small.copy(
                fontSize = 11.sp,
                lineHeight = 14.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.6.sp,
                fontFeatureSettings = "c2sc, smcp",
            ),
            color = RidersColors.textSecondary,
        )
        StopContactName(name = name, phone = phone, actions = callable)
    }
}

@Composable
private fun StopNotes(
    address: String,
    landmark: String?,
    instructions: String?,
) {
    distinctStopDetail(address, landmark)?.let {
        Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
    }
    distinctStopDetail(address, instructions)?.let {
        Text(it, style = RidersType.caption, color = RidersColors.textSecondary)
    }
}
