package com.riders.rider.feature.profile.presentation

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.PhoneWithFlag
import com.riders.rider.core.design.RidersButtonTone
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.feature.onboarding.domain.riderReadiness
import com.riders.rider.core.io.readAtMost
import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_BYTES
import com.riders.rider.feature.profile.domain.ProfilePhotoPhase
import com.riders.rider.feature.profile.domain.ProfilePhotoState
import com.riders.rider.feature.profile.domain.canStartProfilePhotoAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val ProfileGreen = Color(0xFFC9EFD9)
private val ProfileMid = Color(0xFFE5F7EE)
private val ProfileFade = Color(0xFFF7FCF9)
private val PendingReview = Color(0xFFB86E00)
private val PendingReviewFill = Color(0xFFFFF4E5)

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
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { stream ->
                        readAtMost(stream, PROFILE_PHOTO_MAX_BYTES + 1)
                    }
                } catch (_: SecurityException) {
                    null
                } catch (_: java.io.IOException) {
                    null
                }
            }
            if (bytes == null) {
                model.reportPhoto("Choose a profile photo")
            } else {
                model.uploadPhoto(bytes)
            }
        }
    }
    LaunchedEffect(Unit) { model.refresh(force = false) }
    var confirmRemove by rememberSaveable { mutableStateOf(false) }
    val board = ui.board
    val hasProfile = board.fullName.isNotBlank() || board.onboarding != null
    val displayedPhoto = when {
        ui.photo.showingPreview && ui.photoPreview != null -> ui.photoPreview
        ui.photo.showingStored || ui.photo.showingPreview -> ui.photoBitmap
        else -> null
    }
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
            ProfileHeader(
                name = board.fullName,
                onboarding = board.onboarding,
                photo = displayedPhoto,
                photoState = ui.photo,
                onChangePhoto = { picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly)) },
                onRemovePhoto = { confirmRemove = true },
            )
            if (hasProfile) {
                DetailsCard(
                    phone = board.phone,
                    address = board.address,
                    onboarding = board.onboarding,
                    hasLicence = board.hasLicence,
                    motorcycles = board.motorcycles,
                    onMotorcycles = onMotorcycles,
                    modifier = Modifier
                        .padding(end = RidersSpacing.lg)
                        .pullUp(RidersSpacing.xxxl),
                )
            }
            Column(
                Modifier
                    .padding(horizontal = RidersSpacing.lg)
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
                        if (board.error != null) {
                            RidersFailureNotice(
                                message = board.error.orEmpty(),
                                onRetry = { model.refresh(force = true) },
                            )
                        }
                        ui.photo.error?.let { message ->
                            RidersErrorState(
                                message = message,
                                retryLabel = if (ui.photo.retry != null) "Try again" else null,
                                onRetry = model::retryPhoto,
                            )
                        }
                        RidersSecondaryButton(
                            label = "Log out",
                            onClick = model::logout,
                            enabled = !ui.signingOut,
                            loading = ui.signingOut,
                            tone = RidersButtonTone.Danger,
                            bordered = false,
                            icon = R.drawable.ic_logout_outline,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
    if (confirmRemove && ui.photo.hasStoredPhoto && canStartProfilePhotoAction(ui.photo)) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = {
                Text("Remove profile photo?", style = RidersType.heading, color = RidersColors.text)
            },
            text = {
                Text(
                    "Customers will see your initials instead.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmRemove = false
                    model.removePhoto()
                }) {
                    Text("Remove photo", color = RidersColors.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemove = false }) {
                    Text("Keep photo")
                }
            },
        )
    }
}

@Composable
private fun ProfileHeader(
    name: String,
    onboarding: RiderOnboarding?,
    photo: Bitmap?,
    photoState: ProfilePhotoState,
    onChangePhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
) {
    val status = onboarding?.approvalStatus
    val pill = if (status == null) "Rider" else approvalStatusTitle(status)
    val pendingReview = pill == "Pending review"
    val pillColor = when {
        pendingReview -> PendingReview
        pill == "Approved" -> RidersColors.textInverse
        status == "REJECTED" || status == "SUSPENDED" -> RidersColors.error
        else -> RidersColors.primaryDark
    }
    val pillFill = when {
        pendingReview -> PendingReviewFill
        pill == "Approved" -> RidersColors.primary
        else -> RidersColors.background
    }
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().clipToBounds()) {
            ProfileBackdrop(Modifier.matchParentSize())
            Column(
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(top = RidersSpacing.lg, bottom = RidersSpacing.xl),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                ProfileAvatar(
                    name = name,
                    photo = photo,
                    busy = !canStartProfilePhotoAction(photoState),
                    onChangePhoto = onChangePhoto,
                )
                if (photoState.phase == ProfilePhotoPhase.Uploading) {
                    Text(
                        "Uploading ${photoState.progress ?: 0}%",
                        style = RidersType.caption,
                        color = RidersColors.text,
                    )
                }
                if (photoState.hasStoredPhoto && canStartProfilePhotoAction(photoState)) {
                    Text(
                        "Remove photo",
                        style = RidersType.bodyStrong,
                        color = RidersColors.error,
                        modifier = Modifier
                            .clip(RoundedCornerShape(RidersRadius.pill))
                            .clickable(role = Role.Button, onClick = onRemovePhoto)
                            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs)
                            .semantics { contentDescription = "Remove photo" },
                    )
                }
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
                        .background(pillFill)
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
private fun ProfileAvatar(
    name: String,
    photo: Bitmap?,
    busy: Boolean,
    onChangePhoto: () -> Unit,
) {
    Box(
        Modifier
            .size(80.dp)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(Color(0xFF3D5A80))
            .semantics { contentDescription = "Change profile photo" }
            .then(
                if (busy) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onChangePhoto)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                bitmap = photo.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(profileInitials(name), style = RidersType.title, color = RidersColors.textInverse)
        }
        if (busy) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp)
            }
        }
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
            icon = R.drawable.ic_phone_outline,
            label = "WhatsApp number",
        ) {
            if (phone.isBlank()) {
                Text("Verified phone", style = RidersType.bodyStrong, color = RidersColors.text)
            } else {
                PhoneWithFlag(phone, style = RidersType.bodyStrong, color = RidersColors.text)
            }
        }
        Hairline()
        InfoRow(
            icon = R.drawable.ic_map_marker_outline,
            label = "Address",
            value = address.ifBlank { "Not added" },
        )
        Hairline()
        InfoRow(
            icon = R.drawable.ic_card_outline,
            label = "Driving licence",
            value = licenceSummary(onboarding, hasLicence),
        )
        onboarding?.rejectionReason?.takeIf { it.isNotBlank() }?.let { reason ->
            Text(
                reason,
                style = RidersType.caption,
                color = RidersColors.error,
                modifier = Modifier.padding(start = 34.dp, bottom = RidersSpacing.sm),
            )
        }
        Hairline()
        InfoRow(
            icon = R.drawable.ic_mdi_motorbike,
            label = "Motorbike",
            value = motorcycleSummary(motorcycles),
            onClick = onMotorcycles,
        )
        Hairline()
    }
}

@Composable
private fun Hairline() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 34.dp)
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
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = Color.Black,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
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
                painter = painterResource(R.drawable.ic_chevron_right_outline),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = Color.Black,
            )
        }
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
