package com.riders.rider.feature.profile.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.PhoneWithFlag
import com.riders.rider.core.design.RidersButtonTone
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersNetworkNotice
import com.riders.rider.core.design.isConnectionFailure
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.feature.auth.presentation.findFragmentActivity
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.feature.onboarding.domain.riderReadiness

private val ProfileGreen = Color(0xFFC9EFD9)
private val ProfileMid = Color(0xFFE5F7EE)
private val ProfileFade = Color(0xFFF7FCF9)
private val PhoneBlue = Color(0xFF3B6FE8)
private val PhoneFill = Color(0xFFE8F1FF)
private val LicenceFill = Color(0xFFEEF2F6)
private val LicenceTint = Color(0xFF3D5A80)
private val BikeFill = Color(0xFFDDF3E8)

@Composable
private fun PasswordCard(
    saving: Boolean,
    error: String?,
    saved: Boolean,
    onSave: (String, String) -> Unit,
) {
    var password by rememberSaveable { mutableStateOf("") }
    var currentPassword by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
        RidersTextField(
            label = "New password",
            value = password,
            onValueChange = { password = it },
            placeholder = "12 or more characters",
            enabled = !saving,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
            visualTransformation = PasswordVisualTransformation(),
        )
        RidersTextField(
            label = "Current password",
            value = currentPassword,
            onValueChange = { currentPassword = it },
            placeholder = "Only if you already have one",
            enabled = !saving,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            visualTransformation = PasswordVisualTransformation(),
        )
        if (error != null) {
            RidersFailureNotice(message = error)
        }
        if (saved) {
            Text("Password saved. This phone stays signed in.", style = RidersType.caption, color = RidersColors.primaryDark)
        }
        RidersPrimaryButton(
            label = "Save password",
            onClick = { onSave(password, currentPassword) },
            loading = saving,
            enabled = !saving,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
fun ProfileScreen(
    onMotorcycles: () -> Unit,
    model: ProfileViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = context.findFragmentActivity()
        ?: error("Profile requires the rider activity")
    val session: SessionViewModel = hiltViewModel(activity)
    val sessionUi by session.ui.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { model.refresh(force = false) }
    val board = ui.board
    val hasProfile = board.fullName.isNotBlank() || board.onboarding != null
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.refresh(force = true) },
        modifier = Modifier
            .fillMaxSize()
            .background(RidersColors.background),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = RidersSpacing.xxl),
        ) {
            ProfileHeader(board.fullName, board.onboarding)
            if (hasProfile) {
                DetailsCard(
                    phone = board.phone,
                    address = board.address,
                    onboarding = board.onboarding,
                    hasLicence = board.hasLicence,
                    motorcycles = board.motorcycles,
                    onMotorcycles = onMotorcycles,
                    modifier = Modifier
                        .padding(horizontal = RidersSpacing.xl)
                        .pullUp(RidersSpacing.xxxl),
                )
            }
            Column(
                Modifier
                    .padding(horizontal = RidersSpacing.xl)
                    .padding(top = if (hasProfile) RidersSpacing.lg else RidersSpacing.xl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                when {
                    !hasProfile && (ui.loading || !board.loaded) -> RidersLoadingState("Loading your profile")
                    !hasProfile && board.error != null -> RidersFailureNotice(
                        message = board.error.orEmpty(),
                        title = "Profile unavailable",
                        onRetry = { model.refresh(force = true) },
                    )
                    else -> {
                        val pageConnection = isConnectionFailure(board.error)
                        if (board.error != null) {
                            RidersFailureNotice(
                                message = board.error.orEmpty(),
                                onRetry = { model.refresh(force = true) },
                            )
                        }
                        if (sessionUi.biometricAction != null) {
                            BiometricCard(
                                enabled = sessionUi.biometricAction == "Turn off biometric unlock",
                                busy = sessionUi.working || ui.signingOut,
                                error = sessionUi.error?.takeUnless { pageConnection && isConnectionFailure(it) },
                                onToggle = { session.onHomeBiometric(activity) },
                            )
                        }
                        RidersSecondaryButton(
                            label = "Log out",
                            onClick = model::logout,
                            enabled = !ui.signingOut,
                            loading = ui.signingOut,
                            tone = RidersButtonTone.Danger,
                            icon = R.drawable.ic_logout,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileHeader(name: String, onboarding: RiderOnboarding?) {
    val status = onboarding?.approvalStatus
    val pill = if (status == null) "Rider" else approvalStatusTitle(status)
    val pillColor = if (status == "REJECTED" || status == "SUSPENDED") RidersColors.error else RidersColors.primaryDark
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().clipToBounds()) {
            ProfileBackdrop(Modifier.matchParentSize())
            Column(
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = RidersSpacing.xl)
                    .padding(top = RidersSpacing.lg, bottom = RidersSpacing.xl),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                ProfileAvatar(name)
                Text(
                    name.ifBlank { "Profile" },
                    style = RidersType.title,
                    color = RidersColors.text,
                    textAlign = TextAlign.Center,
                )
                Text(
                    pill,
                    style = RidersType.captionStrong,
                    color = pillColor,
                    modifier = Modifier
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(RidersColors.background)
                        .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(RidersSpacing.xxxl)
                .background(Brush.verticalGradient(listOf(ProfileFade, RidersColors.background))),
        )
    }
}

@Composable
private fun ProfileBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.clipToBounds()) {
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to ProfileGreen,
                        0.62f to ProfileMid,
                        1f to ProfileFade,
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
private fun ProfileAvatar(name: String) {
    Box(
        Modifier
            .size(80.dp)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(Color(0xFF3D5A80)),
        contentAlignment = Alignment.Center,
    ) {
        Text(profileInitials(name), style = RidersType.title, color = RidersColors.textInverse)
    }
}

@Composable
private fun DetailsCard(
    phone: String,
    address: String,
    onboarding: RiderOnboarding?,
    hasLicence: Boolean,
    motorcycles: List<MotorcycleDetails>,
    onMotorcycles: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(RidersRadius.xl)
    Column(
        modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(shape)
            .background(RidersColors.background)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
    ) {
        InfoRow(
            icon = R.drawable.ic_phone,
            label = "WhatsApp number",
            iconTint = PhoneBlue,
            iconFill = PhoneFill,
        ) {
            if (phone.isBlank()) {
                Text("Verified phone", style = RidersType.bodyStrong, color = RidersColors.text)
            } else {
                PhoneWithFlag(phone, style = RidersType.bodyStrong, color = RidersColors.text)
            }
        }
        Hairline()
        InfoRow(
            icon = R.drawable.ic_map_marker,
            label = "Address",
            value = address.ifBlank { "Not added" },
            iconTint = RidersColors.primaryDark,
            iconFill = RidersColors.primaryLight,
        )
        Hairline()
        InfoRow(
            icon = R.drawable.ic_card,
            label = "Driving licence",
            value = licenceSummary(onboarding, hasLicence),
            badges = licenceBadges(onboarding),
            iconTint = LicenceTint,
            iconFill = LicenceFill,
        )
        onboarding?.rejectionReason?.takeIf { it.isNotBlank() }?.let { reason ->
            Text(
                reason,
                style = RidersType.caption,
                color = RidersColors.error,
                modifier = Modifier.padding(start = 52.dp, bottom = RidersSpacing.sm),
            )
        }
        Hairline()
        InfoRow(
            icon = R.drawable.ic_motorbike,
            label = "Motorbike",
            value = motorcycleSummary(motorcycles),
            iconTint = RidersColors.primaryDark,
            iconFill = BikeFill,
            onClick = onMotorcycles,
        )
    }
}

@Composable
private fun Hairline() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 52.dp)
            .height(1.dp)
            .background(RidersColors.border),
    )
}

@Composable
private fun InfoRow(
    icon: Int,
    label: String,
    value: String? = null,
    caption: String? = null,
    iconTint: Color = RidersColors.primaryDark,
    iconFill: Color = RidersColors.background,
    badges: List<String> = emptyList(),
    onClick: (() -> Unit)? = null,
    valueContent: (@Composable () -> Unit)? = null,
) {
        Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(vertical = RidersSpacing.md),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, iconTint, iconFill)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                Text(label, style = RidersType.caption, color = RidersColors.textSecondary, modifier = Modifier.weight(1f))
                badges.forEach { StatusBadge(it) }
            }
            if (valueContent != null) {
                valueContent()
            } else {
                Text(value.orEmpty(), style = RidersType.bodyStrong, color = RidersColors.text)
            }
            if (caption != null) {
                Text(caption, style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        if (onClick != null) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_right),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = RidersColors.textSecondary,
            )
        }
    }
}

@Composable
private fun StatusBadge(label: String) {
    Text(
        label,
        style = RidersType.captionStrong,
        color = RidersColors.primaryDark,
        modifier = Modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(RidersColors.primaryLight)
            .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.xs),
    )
}

@Composable
private fun BiometricCard(
    enabled: Boolean,
    busy: Boolean,
    error: String?,
    onToggle: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.xl))
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, RoundedCornerShape(RidersRadius.xl))
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = RidersSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            IconBadge(R.drawable.ic_fingerprint, RidersColors.primaryDark, RidersColors.primaryLight)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                Text("Unlock with biometrics", style = RidersType.bodyStrong, color = RidersColors.text)
                Text(
                    "Use your fingerprint to unlock the app without signing in again.",
                    style = RidersType.caption,
                    color = RidersColors.textSecondary,
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = { onToggle() },
                enabled = !busy,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = RidersColors.primary,
                    uncheckedTrackColor = RidersColors.border,
                    checkedThumbColor = RidersColors.background,
                    uncheckedThumbColor = RidersColors.background,
                ),
            )
        }
        if (error != null) {
            if (isConnectionFailure(error)) {
                RidersNetworkNotice(onRetry = onToggle, modifier = Modifier.padding(bottom = RidersSpacing.sm))
            } else {
                Text(error, style = RidersType.caption, color = RidersColors.error, modifier = Modifier.padding(bottom = RidersSpacing.sm))
            }
        }
    }
}

@Composable
private fun IconBadge(icon: Int, tint: Color, fill: Color) {
    Box(
        Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(RidersRadius.md))
            .background(fill),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = tint,
        )
    }
}

private fun Modifier.pullUp(overlap: Dp): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = overlap.roundToPx()
    layout(placeable.width, (placeable.height - shift).coerceAtLeast(0)) {
        placeable.placeRelative(0, -shift)
    }
}

private fun profileInitials(name: String): String {
    val letters = name.trim().split(Regex("\\s+")).mapNotNull { word ->
        word.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString()
    }
    return when {
        letters.isEmpty() -> "R"
        letters.size == 1 -> letters.first()
        else -> "${letters.first()}${letters.last()}"
    }
}

private fun licenceSummary(onboarding: RiderOnboarding?, hasLicence: Boolean): String {
    if (onboarding == null) {
        return if (hasLicence) "Uploaded" else "Not uploaded"
    }
    val status = riderReadiness(onboarding).licenceLabel.takeUnless { it == "Verified" }
    val parts = listOfNotNull(
        onboarding.licenceNumber?.takeIf { it.isNotBlank() },
        onboarding.licenceClass?.takeIf { it.isNotBlank() }?.let { "Class $it" },
        status,
    )
    return parts.joinToString(" · ").ifBlank { "On file" }
}

private fun licenceBadges(onboarding: RiderOnboarding?): List<String> {
    if (onboarding?.licenceVerificationStatus != "VERIFIED") {
        return emptyList()
    }
    return listOf("Verified")
}

private fun motorcycleSummary(motorcycles: List<MotorcycleDetails>): String {
    val chosen = motorcycles.firstOrNull { it.isActive } ?: motorcycles.firstOrNull() ?: return "No motorcycle yet"
    val name = listOf(chosen.make, chosen.model).filter { it.isNotBlank() }.joinToString(" ")
    val status = when {
        chosen.isActive || chosen.verificationStatus == "VERIFIED" -> null
        else -> motorcycleStatusTitle(chosen.verificationStatus)
    }
    return listOfNotNull(chosen.registrationNumber.takeIf { it.isNotBlank() }, name.takeIf { it.isNotBlank() }, status)
        .joinToString(" · ")
        .ifBlank { "Motorcycle" }
}
