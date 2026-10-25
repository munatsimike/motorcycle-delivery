package com.riders.rider.feature.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersAvailability
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersNetworkNotice
import com.riders.rider.core.design.isConnectionFailure
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersStatusIndicator
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.offers.domain.shouldAskNotificationPermission
import com.riders.rider.feature.offers.notification.markNotificationPermissionAsked
import com.riders.rider.feature.offers.notification.notificationPermissionWasAsked
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.needsOnboarding
import com.riders.rider.feature.wallet.domain.walletMoneyLabel
import java.util.Calendar

@Composable
fun HomeScreen(
    onOffers: () -> Unit,
    onWallet: () -> Unit = {},
    onDelivery: (String) -> Unit,
    onSetup: () -> Unit = {},
    inShell: Boolean = false,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            model.goOnline()
        } else {
            model.locationPermissionDenied()
        }
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (shouldAskNotificationPermission(Build.VERSION.SDK_INT, granted, notificationPermissionWasAsked(context))) {
            markNotificationPermissionAsked(context)
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
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
        onReceiving = model::setReceiving,
        onOffers = onOffers,
        onWallet = onWallet,
        onDelivery = onDelivery,
        onRefresh = model::refresh,
        onSetup = onSetup,
        includeNavigationBars = !inShell,
    )
}

@Composable
fun HomeDashboard(
    ui: HomeUi,
    greeting: String,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onReceiving: (Boolean) -> Unit = {},
    onOffers: () -> Unit,
    onDelivery: (String) -> Unit = { _ -> },
    onRefresh: () -> Unit = {},
    onSetup: () -> Unit = {},
    onWallet: () -> Unit = {},
    includeNavigationBars: Boolean = true,
) {
    BoxWithConstraints(Modifier.fillMaxSize().background(RidersColors.background)) {
        val horizontal = if (maxWidth < 360.dp) RidersSpacing.lg else RidersSpacing.xl
        val readiness = ui.readiness
        RidersPullRefresh(
            refreshing = ui.refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .then(if (includeNavigationBars) Modifier.navigationBarsPadding() else Modifier),
        ) {
            Box(Modifier.fillMaxWidth().clipToBounds()) {
                GreenHomeBackdrop(Modifier.matchParentSize())
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = horizontal)
                        .padding(top = RidersSpacing.lg, bottom = RidersSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RiderInitialsAvatar(ui.fullName)
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                        ) {
                            Text(greeting, style = RidersType.caption, color = RidersColors.textSecondary)
                            riderFirstName(ui.fullName)?.let { firstName ->
                                Text(
                                    firstName,
                                    style = RidersType.heading.copy(fontWeight = FontWeight.SemiBold),
                                    color = RidersColors.text,
                                )
                            }
                        }
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(RidersRadius.lg))
                                .background(RidersColors.background)
                                .clickable(role = Role.Button, onClick = onOffers),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_bell),
                                contentDescription = "Notifications",
                                modifier = Modifier.size(22.dp),
                                tint = RidersColors.text,
                            )
                        }
                    }
                    when {
                        ui.loading && readiness == null -> RidersLoadingState("Checking your account")
                        readiness == null -> RidersFailureNotice(
                            message = ui.error ?: "Your account could not be loaded. Check your connection and try again.",
                            title = "Connection unavailable",
                            onRetry = onRefresh,
                        )
                        else -> {
                            if (ui.loading && !ui.refreshing) {
                                Text("Updating your status", style = RidersType.caption, color = RidersColors.textSecondary)
                            }
                            AvailabilityCard(
                                readiness = readiness,
                                loading = ui.loading,
                                changingAvailability = ui.changingAvailability,
                                receiving = receivingControl(
                                    receiving = ui.onboarding?.receiving,
                                    canAcceptDeliveries = readiness.canAcceptDeliveries,
                                    changing = ui.changingAvailability || ui.changingReceiving,
                                ),
                                changingReceiving = ui.changingReceiving,
                                showFinishSetup = ui.onboarding != null && needsOnboarding(ui.onboarding) && !readiness.canGoOnline && !ui.applicationSubmitted,
                                showViewApplication = ui.applicationSubmitted,
                                showGoOnline = ui.shift.showGoOnline && readiness.canGoOnline,
                                showGoOffline = ui.shift.showGoOffline,
                                onGoOnline = onGoOnline,
                                onGoOffline = onGoOffline,
                                onReceiving = onReceiving,
                                onSetup = onSetup,
                            )
                        }
                    }
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(12.dp)
                    .background(Brush.verticalGradient(listOf(Color(0xFFF7FCF9), RidersColors.background))),
            )
            Spacer(Modifier.height(RidersSpacing.xs))
            if (readiness != null) {
                Column(
                    Modifier.padding(horizontal = horizontal).padding(bottom = RidersSpacing.lg),
                    verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                ) {
                    val recoveryText = if (ui.shift.recoveryFailed) {
                        ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again."
                    } else {
                        null
                    }
                    val pageConnection = isConnectionFailure(ui.error) || isConnectionFailure(recoveryText)
                    if (pageConnection) {
                        RidersNetworkNotice(onRetry = onRefresh)
                    }
                    HomeSummaries(
                        balance = ui.walletBalance,
                        currency = ui.walletCurrency,
                        activeRequestCount = ui.activeRequestCount,
                        availableCapacity = ui.walletAvailableCapacity,
                        reservedFees = ui.walletReservedFees,
                        showWalletCapacity = ui.onboarding?.receiving != null,
                        onWallet = onWallet,
                        onRequests = onOffers,
                    )
                    if (ui.onboarding?.receiving != null || ui.committedV2) {
                        WorkloadCard(flexible = ui.flexibleCount, express = ui.expressCount)
                    }
                    val recoveryOnly = pageConnection &&
                        ui.shift.recoveryFailed &&
                        !ui.shift.recovering &&
                        !ui.shift.recoveryRequired &&
                        !ui.shift.showActiveDelivery
                    if (showActiveSection(ui) && !recoveryOnly) {
                        ActiveDeliverySection(ui, onDelivery, suppressConnection = pageConnection)
                    }
                    if (!ui.assignmentsUnknown) {
                        RequestsSection(ui, onOffers)
                    }
                    if (ui.error != null && ui.error != ui.shift.recoveryMessage && !isConnectionFailure(ui.error)) {
                        RidersErrorState(message = ui.error)
                    }
                    Spacer(Modifier.height(RidersSpacing.lg))
                }
            }
        }
        }
    }
}

@Composable
private fun GreenHomeBackdrop(modifier: Modifier = Modifier) {
    Box(modifier) {
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
private fun RiderInitialsAvatar(fullName: String) {
    val initials = riderInitials(fullName)
    val palette = riderAvatarColors(fullName)
    Box(
        Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(palette.background),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            color = palette.foreground,
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun riderFirstName(fullName: String): String? {
    return fullName.trim().split(Regex("\\s+")).firstOrNull { it.isNotEmpty() }
}

private fun riderInitials(fullName: String): String {
    val letters = fullName.trim().split(Regex("\\s+")).mapNotNull { word ->
        word.firstOrNull { it.isLetter() }?.uppercase(Locale.ENGLISH)
    }
    return when {
        letters.isEmpty() -> "R"
        letters.size == 1 -> letters.first()
        else -> letters.first() + letters.last()
    }
}

private data class AvatarPalette(val background: Color, val foreground: Color)

private val avatarPalettes = listOf(
    AvatarPalette(Color(0xFF3D5A80), RidersColors.textInverse),
    AvatarPalette(Color(0xFFC46B4A), RidersColors.textInverse),
    AvatarPalette(Color(0xFF6B5478), RidersColors.textInverse),
    AvatarPalette(Color(0xFFF3E6D8), RidersColors.text),
)

private fun riderAvatarColors(fullName: String): AvatarPalette {
    if (fullName.isBlank()) {
        return avatarPalettes.first()
    }
    var hash = 0
    for (character in fullName) {
        hash = ((hash.toLong() * 31 + character.code) and 0xFFFFFFFFL).toInt()
    }
    return avatarPalettes[(hash.toUInt() % avatarPalettes.size.toUInt()).toInt()]
}

@Composable
private fun HomeSummaries(
    balance: String?,
    currency: String?,
    activeRequestCount: Int?,
    availableCapacity: String?,
    reservedFees: String?,
    showWalletCapacity: Boolean,
    onWallet: () -> Unit,
    onRequests: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(RidersColors.canvas)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.md),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SummaryTile(
            icon = R.drawable.ic_nav_wallet,
            label = "Wallet balance",
            value = if (balance != null && currency != null) walletMoneyLabel(currency, balance) else "—",
            iconBackground = Color(0xFFF6E3D0),
            accent = Color(0xFFE08A3C),
            largeValue = true,
            onClick = onWallet,
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier
                .padding(horizontal = RidersSpacing.md)
                .width(1.dp)
                .height(88.dp)
                .background(RidersColors.border),
        )
        SummaryTile(
            icon = R.drawable.ic_nav_deliveries,
            label = "Active requests",
            value = activeRequestCount?.toString() ?: "—",
            iconBackground = Color(0xFFD7E9F8),
            accent = Color(0xFF3B78D8),
            largeValue = true,
            onClick = onRequests,
            modifier = Modifier.weight(1f),
        )
    }
        if (showWalletCapacity) {
            Text(
                capacityLine(currency, availableCapacity, reservedFees),
                style = RidersType.caption,
                color = RidersColors.textSecondary,
            )
        }
    }
}

private fun capacityLine(currency: String?, availableCapacity: String?, reservedFees: String?): String {
    val capacity = if (availableCapacity != null && currency != null) walletMoneyLabel(currency, availableCapacity) else "—"
    val reserved = if (reservedFees != null && currency != null) walletMoneyLabel(currency, reservedFees) else "—"
    return "Available capacity $capacity · Reserved fees $reserved"
}

@Composable
private fun WorkloadCard(flexible: Int?, express: Int?) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg)) {
            WorkloadCount("Flexible", flexible, Modifier.weight(1f))
            WorkloadCount("Express", express, Modifier.weight(1f))
        }
    }
}

@Composable
private fun WorkloadCount(label: String, count: Int?, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
        Text(count?.toString() ?: "—", style = RidersType.heading, color = RidersColors.text)
    }
}

@Composable
private fun SummaryTile(
    icon: Int,
    label: String,
    value: String,
    iconBackground: Color,
    accent: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    largeValue: Boolean = false,
) {
    val valueStyle = RidersType.heading.copy(
        fontSize = if (largeValue) 24.sp else RidersType.heading.fontSize,
        lineHeight = if (largeValue) 28.sp else 22.sp,
        platformStyle = PlatformTextStyle(includeFontPadding = false),
    )
    Box(
        modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = RidersSpacing.xs, end = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(RidersRadius.lg))
                    .background(iconBackground),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(icon),
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = accent,
                )
            }
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
            ) {
                Text(
                    label,
                    maxLines = 1,
                    softWrap = false,
                    style = RidersType.caption.copy(
                        fontSize = 13.sp,
                        lineHeight = 16.sp,
                        platformStyle = PlatformTextStyle(includeFontPadding = false),
                    ),
                    color = RidersColors.textSecondary,
                    textAlign = TextAlign.Center,
                )
                Text(value, style = valueStyle, color = RidersColors.text, textAlign = TextAlign.Center)
            }
        }
        Icon(
            painter = painterResource(R.drawable.ic_chevron_right),
            contentDescription = null,
            modifier = Modifier.align(Alignment.CenterEnd).size(20.dp),
            tint = accent,
        )
    }
}

@Composable
private fun AvailabilityCard(
    readiness: RiderReadiness,
    loading: Boolean,
    changingAvailability: Boolean,
    receiving: ReceivingControl,
    changingReceiving: Boolean,
    showFinishSetup: Boolean,
    showViewApplication: Boolean,
    showGoOnline: Boolean,
    showGoOffline: Boolean,
    onGoOnline: () -> Unit,
    onGoOffline: () -> Unit,
    onReceiving: (Boolean) -> Unit,
    onSetup: () -> Unit,
) {
    RidersCard(prominent = true, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                painter = painterResource(R.drawable.rider_image),
                contentDescription = null,
                modifier = Modifier.width(129.dp).height(97.dp),
                contentScale = ContentScale.Fit,
            )
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                horizontalAlignment = Alignment.Start,
            ) {
                if (readiness.availabilityLabel == "Available") {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF3DAF78)),
                        )
                        Text("You are online", style = RidersType.heading, color = RidersColors.text)
                    }
                    Text(
                        if (receiving.visible && !receiving.checked) {
                            "You are online. New requests are paused."
                        } else {
                            "Stay online to receive delivery requests."
                        },
                        style = RidersType.body,
                        color = RidersColors.textSecondary,
                    )
                } else if (readiness.canGoOnline) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(RidersColors.textSecondary),
                        )
                        Text("You are offline", style = RidersType.heading, color = RidersColors.text)
                    }
                    Text(
                        "You cannot accept deliveries.",
                        style = RidersType.body,
                        color = RidersColors.textSecondary,
                    )
                } else if (readiness.approvalLabel == "Pending") {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(RidersColors.textSecondary),
                        )
                        Text("You are offline", style = RidersType.heading, color = RidersColors.text)
                    }
                    Text(
                        "Your account is waiting for approval",
                        style = RidersType.body,
                        color = RidersColors.textSecondary,
                    )
                } else {
                    RidersStatusIndicator(availabilityFor(readiness))
                    Text(readiness.message, style = RidersType.body, color = RidersColors.text)
                }
                if (receiving.visible) {
                    ReceivingSwitch(receiving, changingReceiving, onReceiving)
                }
            }
        }
        if (showViewApplication) {
            RidersSecondaryButton(
                label = "View application",
                onClick = onSetup,
                enabled = !loading,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (showFinishSetup) {
            RidersPrimaryButton(
                label = "Finish setup",
                onClick = onSetup,
                enabled = !loading,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (showGoOnline) {
            RidersPrimaryButton(
                label = "Go online",
                onClick = onGoOnline,
                enabled = !loading && !changingAvailability,
                loading = changingAvailability,
                loadingLabel = "Going online",
                icon = R.drawable.ic_power,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (showGoOffline) {
            RidersSecondaryButton(
                label = "Go offline",
                onClick = onGoOffline,
                enabled = !loading && !changingAvailability,
                loading = changingAvailability,
                icon = R.drawable.ic_power,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ReceivingSwitch(
    receiving: ReceivingControl,
    changingReceiving: Boolean,
    onReceiving: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(
                if (receiving.checked) "Receiving requests" else "Not receiving requests",
                style = RidersType.body,
                color = RidersColors.text,
            )
            if (changingReceiving) {
                Text("Saving receiving preference", style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        Switch(
            checked = receiving.checked,
            onCheckedChange = onReceiving,
            enabled = receiving.enabled,
            modifier = Modifier.semantics { contentDescription = "Receiving requests" },
        )
    }
}

@Composable
internal fun ActiveDeliverySection(
    ui: HomeUi,
    onDelivery: (String) -> Unit,
    suppressConnection: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Text("Active delivery", style = RidersType.heading, color = RidersColors.text)
        val recoveryMessage = ui.shift.recoveryMessage ?: "Your current delivery could not be loaded. Check your connection and try again."
        val hideRecovery = suppressConnection && isConnectionFailure(recoveryMessage)
        when {
            ui.shift.recovering -> RidersLoadingState("Checking your active delivery")
            ui.shift.recoveryFailed && !hideRecovery -> RidersFailureNotice(
                message = recoveryMessage,
                title = "Connection unavailable",
            )
            ui.shift.recoveryRequired -> RidersCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    ui.shift.recoveryMessage ?: "You are marked as busy, but there is no active delivery to resume. You cannot go online.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            }
            ui.shift.showActiveDelivery && ui.active != null -> ActiveDeliveryCard(ui.active, onDelivery)
            ui.shift.recoveryFailed -> Unit
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
    onOffers: () -> Unit,
) {
    val requestCount = ui.activeRequestCount ?: 0
    val hasRequests = ui.shift.showOffers && requestCount > 0
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        Text(
            "Delivery requests",
            style = RidersType.heading.copy(
                lineHeight = 24.sp,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
            ),
            color = RidersColors.text,
        )
        if (hasRequests) {
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
            RidersEmptyState(
                title = "No delivery requests",
                body = "New delivery requests will appear here.",
                image = R.drawable.parcel_box,
                compactTop = true,
            )
        }
    }
}

private fun showActiveSection(ui: HomeUi): Boolean {
    return showsV1ActiveDelivery(ui.onboarding?.receiving, ui.shift, ui.committedV2, ui.assignmentsUnknown)
}

private fun availabilityFor(readiness: RiderReadiness): RidersAvailability = when (readiness.availabilityLabel) {
    "Available" -> RidersAvailability.Available
    "On a delivery" -> RidersAvailability.Busy
    else -> RidersAvailability.Offline
}

internal fun ridersGreeting(hour: Int): String = when {
    hour < 12 -> "Good morning"
    hour < 17 -> "Good afternoon"
    else -> "Good evening"
}

private fun locationPermissions(): Array<String> {
    return arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )
}

@Preview(name = "Offline approved", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOfflineApproved() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(offlineReady()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Available", showBackground = true, widthDp = 360)
@Composable
private fun PreviewAvailable() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(availableReady()),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Busy", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusy() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(busyReady(), active = sampleDelivery()),
            greeting = "Good evening",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Pending approval", showBackground = true, widthDp = 360)
@Composable
private fun PreviewPending() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(pendingApproval()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Rejected licence", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRejectedLicence() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(rejectedLicence()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Unverified motorcycle", showBackground = true, widthDp = 360)
@Composable
private fun PreviewMotorcycle() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(unverifiedMotorcycle()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun PreviewLoading() {
    RiderTheme {
        HomeDashboard(
            ui = HomeUi(loading = true),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Recovery failed", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRecoveryFailed() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            ui = previewUi(readiness).copy(
                shift = homeShift("BUSY", readiness.canAcceptDeliveries, null, recoveryFailed = true),
            ),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Busy without delivery", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBusyWithoutDelivery() {
    val readiness = busyReady()
    RiderTheme {
        HomeDashboard(
            ui = previewUi(readiness).copy(active = null, shift = homeShift("BUSY", false, null)),
            greeting = "Good afternoon",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
    }
}

@Preview(name = "Small phone", showBackground = true, widthDp = 320, fontScale = 1.3f)
@Composable
private fun PreviewSmallPhone() {
    RiderTheme {
        HomeDashboard(
            ui = previewUi(offlineReady()),
            greeting = "Good morning",
            onGoOnline = {},
            onGoOffline = {},
            onOffers = {},
            onDelivery = { _ -> },
            onRefresh = {},
        )
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
        fullName = "Tonderai Moyo",
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
