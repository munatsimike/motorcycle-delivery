package com.riders.rider.feature.onboarding.presentation

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.riders.rider.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.onboarding.domain.LICENCE_IMAGE_MAX_BYTES
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.OnboardingStep
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.canEditMotorcycle
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.canSelectMotorcycle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.feature.onboarding.domain.riderReadiness
import java.io.ByteArrayOutputStream
import java.io.InputStream

@Composable
fun OnboardingScreen(
    onFinished: () -> Unit,
    focused: Boolean = false,
    model: OnboardingViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        val bytes = readLicence(context.contentResolver, uri)
        if (bytes == null) {
            model.permissionDenied()
        } else {
            model.selectLicence(bytes)
        }
    }
    LaunchedEffect(Unit) { model.refresh() }
    RiderTheme {
        RidersPullRefresh(
            refreshing = ui.refreshing,
            onRefresh = model::refresh,
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
            if (!focused) {
                OnboardingProgress(ui.step)
            }
            when {
                ui.loading && ui.onboarding == null -> RidersLoadingState("Loading your account")
                ui.onboarding == null -> RidersFailureNotice(
                    message = ui.error ?: "Your account could not be loaded. Check your connection and try again.",
                    title = "Account unavailable",
                    onRetry = model::refresh,
                )
                else -> {
                    when (ui.step) {
                        OnboardingStep.Profile -> ProfileStep(ui)
                        OnboardingStep.Licence -> LicenceStep(
                            ui,
                            onPick = { picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly)) },
                            onSave = model::uploadLicence,
                        )
                        OnboardingStep.Motorcycle -> MotorcycleStep(
                            ui = ui,
                            registration = !focused,
                            onBack = if (focused) onFinished else model::back,
                            onDraft = model::updateDraft,
                            onAdd = model::beginAddMotorcycle,
                            onSave = model::saveMotorcycle,
                            onCancel = model::cancelMotorcycleEdit,
                            onEdit = model::editMotorcycle,
                            onSelect = model::selectMotorcycle,
                        )
                        OnboardingStep.Status -> StatusStep(ui, onHome = onFinished)
                    }
                    ui.notice?.let { SavedNotice(it) }
                    if (ui.error != null) {
                        RidersFailureNotice(message = ui.error ?: "", onRetry = model::refresh)
                    }
                    if (focused && ui.step != OnboardingStep.Motorcycle) {
                        RidersSecondaryButton(label = "Back", onClick = onFinished, modifier = Modifier.fillMaxWidth())
                    } else if (!focused) {
                        Row(horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
                            if (ui.step != OnboardingStep.Profile && ui.step != OnboardingStep.Status) {
                                RidersSecondaryButton(label = "Back", onClick = model::back, modifier = Modifier.weight(1f))
                            }
                            if (ui.step != OnboardingStep.Status) {
                                RidersPrimaryButton(
                                    label = "Continue",
                                    onClick = model::continueStep,
                                    modifier = Modifier.weight(1f),
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

@Composable
private fun SavedNotice(message: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.primaryLight)
            .padding(RidersSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_check),
            contentDescription = null,
            tint = RidersColors.primaryDark,
            modifier = Modifier.size(18.dp),
        )
        Text(message, style = RidersType.bodyStrong, color = RidersColors.primaryDark)
    }
}

@Composable
private fun StepHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
        Text(title, style = RidersType.title, color = RidersColors.text)
        Text(subtitle, style = RidersType.body, color = RidersColors.textSecondary)
    }
}

@Composable
private fun IconTile(icon: Int, tint: Color, fill: Color) {
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
            tint = tint,
            modifier = Modifier.size(22.dp),
        )
    }
}

@Composable
private fun StatusLine(
    icon: Int,
    label: String,
    value: String,
    positive: Boolean,
    negative: Boolean,
) {
    val tint = when {
        negative -> RidersColors.error
        positive -> RidersColors.primaryDark
        else -> Color(0xFFB86E00)
    }
    val fill = when {
        negative -> RidersColors.dangerSurface
        positive -> RidersColors.primaryLight
        else -> Color(0xFFFFF4E5)
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        IconTile(icon, tint, fill)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
            Text(value, style = RidersType.bodyStrong, color = RidersColors.text)
        }
    }
}

@Composable
private fun OnboardingProgress(step: OnboardingStep) {
    val total = OnboardingStep.entries.size
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = RidersColors.primary, fontWeight = FontWeight.Bold)) {
                    append("Step ${step.ordinal + 1}")
                }
                withStyle(SpanStyle(color = RidersColors.textSecondary)) {
                    append(" of $total")
                }
            },
            style = RidersType.caption,
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            repeat(total) { index ->
                Box(
                    Modifier
                        .weight(1f)
                        .height(4.dp)
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(if (index <= step.ordinal) RidersColors.primary else Color(0xFFE4E6E5)),
                )
            }
        }
    }
}

@Composable
private fun ProfileStep(ui: OnboardingUi) {
    if (ui.onboarding == null) {
        return
    }
    val name = ui.fullName.ifBlank { "Name on your account" }
    StepHeading(
        title = "Your profile",
        subtitle = "Review your profile details before continuing.",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.xl))
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, RoundedCornerShape(RidersRadius.xl))
            .padding(RidersSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(Color(0xFF3D5A80)),
            contentAlignment = Alignment.Center,
        ) {
            Text(profileInitials(name), style = RidersType.bodyStrong, color = Color.White)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(name, style = RidersType.bodyStrong, color = RidersColors.text)
            if (ui.phone.isNotBlank()) {
                Text(ui.phone, style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        Row(
            Modifier
                .clip(RoundedCornerShape(RidersRadius.pill))
                .background(RidersColors.primaryLight)
                .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_check),
                contentDescription = null,
                tint = RidersColors.primary,
                modifier = Modifier.size(14.dp),
            )
            Text("Verified", style = RidersType.captionStrong, color = RidersColors.primary)
        }
    }
}

private fun profileInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = when {
        parts.isEmpty() -> ""
        parts.size == 1 -> parts[0].take(1)
        else -> parts.first().take(1) + parts.last().take(1)
    }
    return letters.uppercase()
}

@Composable
private fun LicenceStep(ui: OnboardingUi, onPick: () -> Unit, onSave: () -> Unit) {
    val onboarding = ui.onboarding ?: return
    val replace = canReplaceLicence(onboarding.licenceVerificationStatus)
    StepHeading(
        title = "Driving licence",
        subtitle = "Choose a clear photo, save it, then continue.",
    )
    if (onboarding.rejectionReason != null) {
        Text(onboarding.rejectionReason, style = RidersType.caption, color = RidersColors.error)
    }
    val preview = ui.preview
    val bitmap = remember(preview) {
        preview?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "Selected licence image",
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .border(1.dp, RidersColors.border, RoundedCornerShape(RidersRadius.xl))
                .clip(RoundedCornerShape(RidersRadius.xl)),
            contentScale = ContentScale.Crop,
        )
        Text(
            "Review this photo, then save it.",
            style = RidersType.caption,
            color = RidersColors.textSecondary,
        )
    } else if (ui.licence != null) {
        RidersCard(prominent = true) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
                IconTile(R.drawable.ic_card, Color(0xFF3D5A80), Color(0xFFEEF2F6))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                    Text("Driving licence", style = RidersType.caption, color = RidersColors.textSecondary)
                    Text("Photo uploaded", style = RidersType.bodyStrong, color = RidersColors.text)
                }
            }
            LicenceStatusBadge(ui.licence.reviewStatus, licenceReviewLabel(ui.licence.reviewStatus))
        }
    } else {
        RidersCard(prominent = true) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
                IconTile(R.drawable.ic_card, Color(0xFF3D5A80), Color(0xFFEEF2F6))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                    Text("No licence photo yet", style = RidersType.bodyStrong, color = RidersColors.text)
                    Text("JPEG, PNG, or WebP, up to 5 MB.", style = RidersType.caption, color = RidersColors.textSecondary)
                }
            }
        }
    }
    if (ui.uploading) {
        Text("Uploading ${ui.uploadPercent ?: 0}%", style = RidersType.caption, color = RidersColors.textSecondary)
    }
    if (replace) {
        if (preview != null) {
            RidersPrimaryButton(
                label = "Save licence",
                onClick = onSave,
                enabled = !ui.uploading,
                loading = ui.uploading,
                loadingLabel = "Saving",
                modifier = Modifier.fillMaxWidth(),
            )
            RidersSecondaryButton(
                label = "Choose another image",
                onClick = onPick,
                enabled = !ui.uploading,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            RidersPrimaryButton(
                label = "Upload licence",
                onClick = onPick,
                enabled = !ui.uploading,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    } else {
        Text("A verified licence cannot be replaced yet.", style = RidersType.body, color = RidersColors.textSecondary)
    }
}

@Composable
private fun LicenceStatusBadge(status: String, label: String) {
    val tint = when {
        status == "VERIFIED" -> RidersColors.primary
        status == "REJECTED" -> RidersColors.error
        else -> Color(0xFFB86E00)
    }
    val fill = when {
        status == "VERIFIED" -> RidersColors.primaryLight
        status == "REJECTED" -> RidersColors.dangerSurface
        else -> Color(0xFFFFF4E5)
    }
    Row(
        Modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(fill)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Icon(
            painter = painterResource(
                when {
                    status == "VERIFIED" -> R.drawable.ic_check
                    status == "REJECTED" -> R.drawable.ic_info
                    else -> R.drawable.ic_clock
                },
            ),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(18.dp),
        )
        Text(label, style = RidersType.captionStrong, color = tint)
    }
}

private fun licenceReviewLabel(status: String): String = when (status) {
    "VERIFIED" -> "Verified"
    "REJECTED" -> "Rejected"
    else -> "Pending review"
}

@Composable
private fun MotorcycleStep(
    ui: OnboardingUi,
    registration: Boolean,
    onBack: () -> Unit,
    onDraft: (com.riders.rider.feature.onboarding.domain.MotorcycleDraft) -> Unit,
    onAdd: () -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onEdit: (MotorcycleDetails) -> Unit,
    onSelect: (String) -> Unit,
) {
    StepHeading(
        title = "Motorbike",
        subtitle = "Add the motorcycle you want to use, save it, then continue.",
    )
    ui.motorcycles.forEach { motorcycle ->
        val selected = motorcycle.isActive
        val selectable = canSelectMotorcycle(motorcycle.verificationStatus, motorcycle.isActive)
        val editable = canEditMotorcycle(motorcycle.verificationStatus)
        MotorcycleChoice(
            motorcycle = motorcycle,
            selected = selected,
            enabled = !ui.savingMotorcycle && (selectable || editable),
            onClick = {
                when {
                    selectable -> onSelect(motorcycle.id)
                    editable -> onEdit(motorcycle)
                }
            },
        )
    }
    val editing = ui.editingId != null
    val showForm = editing || ui.addingMotorcycle || (registration && ui.motorcycles.isEmpty() && ui.notice == null)
    if (!showForm) {
        RidersPrimaryButton(
            label = "Add motorbike",
            onClick = onAdd,
            modifier = Modifier.fillMaxWidth(),
        )
        if (!registration) {
            RidersSecondaryButton(
                label = "Back",
                onClick = onBack,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    } else RidersCard(modifier = Modifier.fillMaxWidth(), prominent = true) {
        Text(if (editing) "Update motorcycle" else "Add a motorcycle", style = RidersType.heading, color = RidersColors.text)
        Text(
            "Use the registration book. The number plate, make, model, and colour are all required.",
            style = RidersType.caption,
            color = RidersColors.textSecondary,
        )
        RidersTextField(
            label = "Registration number",
            value = ui.draft.registrationNumber,
            onValueChange = { onDraft(ui.draft.copy(registrationNumber = it)) },
            placeholder = "AEX 1234",
            error = motorcycleFieldError(ui.error, "Enter a registration number"),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md)) {
            RidersTextField(
                label = "Make",
                value = ui.draft.make,
                onValueChange = { onDraft(ui.draft.copy(make = it)) },
                placeholder = "Honda",
                error = motorcycleFieldError(ui.error, "Enter a make"),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.weight(1f),
            )
            RidersTextField(
                label = "Model",
                value = ui.draft.model,
                onValueChange = { onDraft(ui.draft.copy(model = it)) },
                placeholder = "Ace",
                error = motorcycleFieldError(ui.error, "Enter a model"),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.weight(1f),
            )
        }
        RidersTextField(
            label = "Colour",
            value = ui.draft.colour,
            onValueChange = { onDraft(ui.draft.copy(colour = it)) },
            placeholder = "Black",
            error = motorcycleFieldError(ui.error, "Enter a colour"),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
        )
        if (!registration || editing) {
            RidersSecondaryButton(
                label = "Cancel",
                onClick = onCancel,
                enabled = !ui.savingMotorcycle,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        RidersPrimaryButton(
            label = if (editing) "Save changes" else "Save motorcycle",
            onClick = onSave,
            enabled = !ui.savingMotorcycle,
            loading = ui.savingMotorcycle,
            loadingLabel = "Saving",
            modifier = Modifier.fillMaxWidth(),
        )
        if (!registration) {
            RidersSecondaryButton(
                label = "Back",
                onClick = onBack,
                enabled = !ui.savingMotorcycle,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun MotorcycleChoice(
    motorcycle: MotorcycleDetails,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) RidersColors.primaryLight else RidersColors.surface)
            .border(1.dp, if (selected) RidersColors.primary else RidersColors.border, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(RidersSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(RidersRadius.md))
                .background(if (selected) RidersColors.background else Color(0xFFDDF3E8)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_mdi_motorbike),
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = RidersColors.primaryDark,
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(motorcycle.registrationNumber, style = RidersType.heading, color = RidersColors.text)
            Text(
                listOf(motorcycle.make, motorcycle.model).filter { it.isNotBlank() }.joinToString(" "),
                style = RidersType.body,
                color = RidersColors.textSecondary,
            )
            if (!selected && !canSelectMotorcycle(motorcycle.verificationStatus, motorcycle.isActive)) {
                Text(motorcycleStatusTitle(motorcycle.verificationStatus), style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            SelectionMark(selected)
            if (selected) {
                Text(
                    "Active",
                    style = RidersType.captionStrong,
                    color = RidersColors.primaryDark,
                    modifier = Modifier
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(RidersColors.background)
                        .padding(horizontal = RidersSpacing.sm, vertical = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun SelectionMark(selected: Boolean) {
    Box(
        Modifier
            .size(22.dp)
            .clip(CircleShape)
            .background(if (selected) RidersColors.primary else Color.Transparent)
            .border(2.dp, if (selected) RidersColors.primary else RidersColors.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(RidersColors.background),
            )
        }
    }
}

private fun motorcycleFieldError(message: String?, expected: String): String? {
    return message?.takeIf { it == expected }
}

@Composable
private fun StatusStep(ui: OnboardingUi, onHome: () -> Unit) {
    val onboarding = ui.onboarding ?: return
    val readiness = riderReadiness(onboarding)
    StepHeading(
        title = "Approval status",
        subtitle = "This is where your account stands.",
    )
    RidersCard(prominent = true) {
        StatusLine(
            icon = R.drawable.ic_nav_profile,
            label = "Account",
            value = approvalStatusTitle(onboarding.approvalStatus),
            positive = onboarding.approvalStatus == "APPROVED",
            negative = onboarding.approvalStatus == "REJECTED" || onboarding.approvalStatus == "SUSPENDED",
        )
        StatusLine(
            icon = R.drawable.ic_card,
            label = "Driving licence",
            value = readiness.licenceLabel,
            positive = readiness.licenceLabel == "Verified",
            negative = readiness.licenceLabel == "Rejected",
        )
        StatusLine(
            icon = R.drawable.ic_motorbike,
            label = "Motorbike",
            value = if (onboarding.activeVerifiedMotorcycle) {
                "Verified and active"
            } else if (onboarding.verifiedMotorcycleCount > 0) {
                "Verified, not active"
            } else {
                "Not verified"
            },
            positive = onboarding.activeVerifiedMotorcycle,
            negative = false,
        )
    }
    Text(readiness.message, style = RidersType.body, color = RidersColors.text)
    Text(
        "Availability stays offline until an approved account has a verified licence and an active verified motorcycle.",
        style = RidersType.caption,
        color = RidersColors.textSecondary,
    )
    RidersPrimaryButton(label = "Back to home", onClick = onHome, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(RidersSpacing.sm))
}

private fun readLicence(resolver: android.content.ContentResolver, uri: Uri): ByteArray? {
    return try {
        resolver.openInputStream(uri)?.use { stream -> readAtMost(stream, LICENCE_IMAGE_MAX_BYTES + 1) }
    } catch (_: SecurityException) {
        null
    }
}

private fun readAtMost(stream: InputStream, limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val chunk = ByteArray(8 * 1024)
    var total = 0
    while (total <= limit) {
        val read = stream.read(chunk)
        if (read < 0) {
            break
        }
        val allowed = minOf(read, limit - total + 1)
        if (allowed > 0) {
            output.write(chunk, 0, minOf(read, allowed))
        }
        total += read
        if (total > limit) {
            return ByteArray(limit + 1)
        }
    }
    return output.toByteArray()
}
