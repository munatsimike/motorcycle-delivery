package com.riders.rider.feature.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersAvailability
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersStatusIndicator
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.feature.auth.presentation.findFragmentActivity
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.needsOnboarding
import java.util.Calendar

@Composable
fun HomeScreen(
    onOffers: () -> Unit,
    onDelivery: (String) -> Unit,
    onSetup: () -> Unit = {},
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = context.findFragmentActivity()
        ?: error("Home requires the rider activity")
    val session: SessionViewModel = hiltViewModel(activity)
    val sessionUi by session.ui.collectAsStateWithLifecycle()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            model.goOnline()
        }
    }
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
    HomeDashboard(
        ui = ui,
        greeting = ridersGreeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)),
        onGoOnline = {
            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (allowed) {
                model.goOnline()
            } else {
                permission.launch(locationPermissions())
            }
        },
        onGoOffline = model::goOffline,
        onOffers = onOffers,
        onDelivery = onDelivery,
        onRefresh = model::refresh,
        onLogout = model::logout,
        onSetup = onSetup,
        biometricAction = sessionUi.biometricAction,
        biometricError = sessionUi.error,
        onBiometric = { session.onHomeBiometric(activity) },
    )
}

@Composable
fun HomeDashboard(
    ui: HomeUi,
    greeting: String,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onOffers: () -> Unit,
    onDelivery: (String) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onSetup: () -> Unit = {},
    biometricAction: String? = null,
    biometricError: String? = null,
    onBiometric: () -> Unit = {},
) {
    BoxWithConstraints(Modifier.fillMaxSize().background(RidersColors.background)) {
        val horizontal = if (maxWidth < 360.dp) RidersSpacing.lg else RidersSpacing.xl
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding(),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(RidersColors.canvas)
                    .statusBarsPadding()
                    .padding(horizontal = horizontal)
                    .padding(top = RidersSpacing.lg, bottom = RidersSpacing.xl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                RidersWordmark()
                Text(greeting, style = RidersType.caption, color = RidersColors.textSecondary)
            }
            Column(
                Modifier.padding(horizontal = horizontal, vertical = RidersSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                when {
                    ui.loading && ui.readiness == null -> RidersLoadingState("Checking your account")
                    ui.readiness == null -> RidersErrorState(
                        title = "Connection unavailable",
                        message = ui.error ?: "Your account could not be loaded. Check your connection and try again.",
                        retryLabel = "Try again",
                        onRetry = onRefresh,
                    )
                    else -> DashboardBody(
                        ui = ui,
                        readiness = ui.readiness,
                        onGoOnline = onGoOnline,
                        onGoOffline = onGoOffline,
                        onOffers = onOffers,
                        onDelivery = onDelivery,
                        onRefresh = onRefresh,
                        onSetup = onSetup,
                    )
                }
                if (ui.readiness != null && ui.error != null && ui.error != ui.shift.recoveryMessage) {
                    RidersErrorState(message = ui.error)
                }
                Spacer(Modifier.height(RidersSpacing.sm))
                if (biometricAction != null) {
                    if (biometricError != null) {
                        RidersErrorState(message = biometricError)
                    }
                    RidersSecondaryButton(
                        label = biometricAction,
                        onClick = onBiometric,
                        modifier = Modifier.fillMaxWidth(),
                        soft = false,
                    )
                }
                RidersSecondaryButton(label = "Log out", onClick = onLogout, modifier = Modifier.fillMaxWidth(), soft = false)
                Spacer(Modifier.height(RidersSpacing.lg))
            }
        }
    }
}

@Composable
private fun DashboardBody(
    ui: HomeUi,
    readiness: RiderReadiness,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onOffers: () -> Unit,
    onDelivery: (String) -> Unit,
    onRefresh: () -> Unit,
    onSetup: () -> Unit,
) {
    if (ui.loading) {
        Text("Updating your status", style = RidersType.caption, color = RidersColors.textSecondary)
    }
    AvailabilityCard(readiness, ui.onboarding)
    if (ui.onboarding != null && needsOnboarding(ui.onboarding) && !readiness.canGoOnline) {
        RidersPrimaryButton(
            label = "Finish setup",
            onClick = onSetup,
            enabled = !ui.loading,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (ui.shift.showGoOnline && readiness.canGoOnline) {
        RidersPrimaryButton(
            label = "Go online",
            onClick = onGoOnline,
            enabled = !ui.loading && !ui.changingAvailability,
            loading = ui.changingAvailability,
            loadingLabel = "Going online",
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (ui.shift.showGoOffline) {
        RidersSecondaryButton(
            label = "Go offline",
            onClick = onGoOffline,
            enabled = !ui.loading && !ui.changingAvailability,
            loading = ui.changingAvailability,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (showActiveSection(ui)) {
        ActiveDeliverySection(ui, onDelivery, onRefresh)
    }
    RequestsSection(ui, readiness, onOffers)
}

@Composable
private fun AvailabilityCard(readiness: RiderReadiness, onboarding: RiderOnboarding?) {
    RidersCard(prominent = true, modifier = Modifier.fillMaxWidth()) {
        RidersStatusIndicator(availabilityFor(readiness))
        Text(readiness.availabilityLabel, style = RidersType.title, color = RidersColors.text)
        Text(readiness.message, style = RidersType.body, color = RidersColors.text)
        StatusFact("Approval", readiness.approvalLabel)
        StatusFact("Licence", readiness.licenceLabel)
        if (onboarding != null) {
            StatusFact("Motorcycle", if (onboarding.activeVerifiedMotorcycle) "Verified" else "Not verified")
        }
    }
}

@Composable
private fun StatusFact(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
        Text(value, style = RidersType.bodyStrong, color = RidersColors.text)
    }
}

@Composable
private fun ActiveDeliverySection(
    ui: HomeUi,
    onDelivery: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Text("Active delivery", style = RidersType.heading, color = RidersColors.text)
        when {
            ui.shift.recovering -> RidersLoadingState("Checking your active delivery")
            ui.shift.recoveryFailed -> RidersErrorState(
                title = "Connection unavailable",
                message = ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again.",
                retryLabel = "Try again",
                onRetry = onRefresh,
            )
            ui.shift.recoveryRequired -> RidersCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    ui.shift.recoveryMessage ?: "You are marked as busy, but there is no active delivery to resume. You cannot go online.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            }
            ui.shift.showActiveDelivery && ui.active != null -> ActiveDeliveryCard(ui.active, onDelivery)
            else -> RidersEmptyState(
                title = "No active delivery",
                body = "There is no delivery to resume.",
            )
        }
    }
}

@Composable
private fun ActiveDeliveryCard(active: ActiveDelivery, onDelivery: (String) -> Unit) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text(deliveryStatusLabel(active.status), style = RidersType.captionStrong, color = RidersColors.primaryDark)
        if (active.parcelDescription.isNotBlank()) {
            Text(active.parcelDescription, style = RidersType.bodyStrong, color = RidersColors.text)
        }
        if (active.pickupAddress.isNotBlank()) {
            Text("Pickup", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(active.pickupAddress, style = RidersType.body, color = RidersColors.text)
        }
        if (active.dropoffAddress.isNotBlank()) {
            Text("Drop-off", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(active.dropoffAddress, style = RidersType.body, color = RidersColors.text)
        }
        RidersPrimaryButton(
            label = "Open delivery",
            onClick = { onDelivery(active.deliveryId) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun RequestsSection(
    ui: HomeUi,
    readiness: RiderReadiness,
    onOffers: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Text("Delivery requests", style = RidersType.heading, color = RidersColors.text)
        if (ui.shift.showOffers) {
            RidersCard(onClick = onOffers, modifier = Modifier.fillMaxWidth()) {
                Text("Open requests", style = RidersType.bodyStrong, color = RidersColors.text)
                Text(
                    "Requests that are waiting for you are on the next screen.",
                    style = RidersType.caption,
                    color = RidersColors.textSecondary,
                )
                Text("View requests", style = RidersType.button, color = RidersColors.primary)
            }
        } else {
            RidersEmptyState(title = "No delivery requests", body = requestsEmptyBody(readiness))
        }
    }
}

private fun showActiveSection(ui: HomeUi): Boolean {
    return ui.shift.showActiveDelivery || ui.shift.recovering || ui.shift.recoveryFailed || ui.shift.recoveryRequired
}

private fun availabilityFor(readiness: RiderReadiness): RidersAvailability = when (readiness.availabilityLabel) {
    "Available" -> RidersAvailability.Available
    "On a delivery" -> RidersAvailability.Busy
    else -> RidersAvailability.Offline
}

private fun requestsEmptyBody(readiness: RiderReadiness): String = when {
    readiness.canGoOnline -> "Go online to receive delivery requests."
    readiness.availabilityLabel == "On a delivery" -> "New requests wait until this delivery is finished."
    readiness.canAcceptDeliveries -> "New requests appear while you stay available."
    else -> "Requests appear after your account is ready and you go online."
}

internal fun ridersGreeting(hour: Int): String = when {
    hour < 12 -> "Good morning"
    hour < 17 -> "Good afternoon"
    else -> "Good evening"
}

private fun locationPermissions(): Array<String> {
    val permissions = mutableListOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        permissions += Manifest.permission.POST_NOTIFICATIONS
    }
    return permissions.toTypedArray()
}

@Preview(name = "Offline approved", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOfflineApproved() {
    RiderTheme {
        HomeDashboard(previewUi(offlineReady()), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Available", showBackground = true, widthDp = 360)
@Composable
private fun PreviewAvailable() {
    RiderTheme {
        HomeDashboard(previewUi(availableReady()), "Good afternoon", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Busy", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusy() {
    RiderTheme {
        HomeDashboard(
            previewUi(busyReady(), active = sampleDelivery()),
            "Good evening",
            {},
            {},
            {},
            {},
            {},
            {},
        )
    }
}

@Preview(name = "Pending approval", showBackground = true, widthDp = 360)
@Composable
private fun PreviewPending() {
    RiderTheme {
        HomeDashboard(previewUi(pendingApproval()), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Rejected licence", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRejectedLicence() {
    RiderTheme {
        HomeDashboard(previewUi(rejectedLicence()), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Unverified motorcycle", showBackground = true, widthDp = 360)
@Composable
private fun PreviewMotorcycle() {
    RiderTheme {
        HomeDashboard(previewUi(unverifiedMotorcycle()), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun PreviewLoading() {
    RiderTheme {
        HomeDashboard(HomeUi(loading = true), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

@Preview(name = "Recovery failed", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRecoveryFailed() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            previewUi(readiness).copy(
                shift = homeShift("BUSY", readiness.canAcceptDeliveries, null, recoveryFailed = true),
            ),
            "Good afternoon",
            {},
            {},
            {},
            {},
            {},
            {},
        )
    }
}

@Preview(name = "Busy without delivery", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusyWithoutDelivery() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            previewUi(readiness).copy(active = null, shift = homeShift("BUSY", false, null)),
            "Good afternoon",
            {},
            {},
            {},
            {},
            {},
            {},
        )
    }
}

@Preview(name = "Small phone", showBackground = true, widthDp = 320, fontScale = 1.3f)
@Composable
private fun PreviewSmallPhone() {
    RiderTheme {
        HomeDashboard(previewUi(offlineReady()), "Good morning", {}, {}, {}, {}, {}, {})
    }
}

private fun previewUi(readiness: RiderReadiness, active: ActiveDelivery? = null): HomeUi {
    val onboarding = RiderOnboarding(
        licenceVerificationStatus = when (readiness.licenceLabel) {
            "Verified" -> "VERIFIED"
            "Rejected" -> "REJECTED"
            else -> "PENDING"
        },
        approvalStatus = when (readiness.approvalLabel) {
            "Approved" -> "APPROVED"
            "Suspended" -> "SUSPENDED"
            "Rejected" -> "REJECTED"
            else -> "PENDING"
        },
        availability = when (readiness.availabilityLabel) {
            "Available" -> "AVAILABLE"
            "On a delivery" -> "BUSY"
            else -> "OFFLINE"
        },
        licenceNumber = null,
        licenceClass = null,
        rejectionReason = null,
        verifiedMotorcycleCount = if (readiness.message.contains("motorcycle")) 0 else 1,
        activeVerifiedMotorcycle = !readiness.message.contains("motorcycle"),
    )
    return HomeUi(
        loading = false,
        onboarding = onboarding,
        readiness = readiness,
        active = active,
        shift = homeShift(onboarding.availability, readiness.canAcceptDeliveries, active),
    )
}

private fun offlineReady() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = true,
    availabilityLabel = "Offline",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "Your account is approved. You are offline, so you cannot accept deliveries yet.",
)

private fun availableReady() = RiderReadiness(
    canAcceptDeliveries = true,
    canGoOnline = false,
    availabilityLabel = "Available",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You are online. Delivery requests appear while you stay available.",
)

private fun busyReady() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "On a delivery",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You are on a delivery. You cannot change availability until it is finished.",
)

private fun pendingApproval() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Pending review",
    approvalLabel = "Pending",
    message = "Your account is waiting for approval. You cannot accept deliveries yet.",
)

private fun rejectedLicence() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Rejected",
    approvalLabel = "Approved",
    message = "Your licence was rejected: Photo is unreadable",
)

private fun unverifiedMotorcycle() = RiderReadiness(
    canAcceptDeliveries = false,
    canGoOnline = false,
    availabilityLabel = "Offline",
    licenceLabel = "Verified",
    approvalLabel = "Approved",
    message = "You need an active verified motorcycle before you can accept deliveries.",
)

private fun sampleDelivery() = ActiveDelivery(
    deliveryId = "delivery-1",
    assignmentId = "assignment-1",
    status = "ASSIGNED",
    parcelDescription = "Documents",
    pickupAddress = "Samora Machel Avenue, Harare",
    dropoffAddress = "Borrowdale Road, Harare",
)
