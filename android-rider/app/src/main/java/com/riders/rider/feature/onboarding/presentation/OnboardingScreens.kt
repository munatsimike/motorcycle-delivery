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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.riders.rider.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.PhoneWithFlag
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.onboarding.domain.LICENCE_IMAGE_MAX_BYTES
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.OnboardingStep
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.canEditMotorcycle
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.canSelectMotorcycle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.feature.onboarding.domain.profileCompletion
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
            if (ui.step != OnboardingStep.Motorcycle) {
                RidersWordmark()
            }
            if (!focused) {
                Text("Step ${ui.step.ordinal + 1} of 4", style = RidersType.caption, color = RidersColors.textSecondary)
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
                        OnboardingStep.Licence -> LicenceStep(ui, onChoose = {
                            picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly))
                        }, onUpload = model::uploadLicence)
                        OnboardingStep.Motorcycle -> MotorcycleStep(
                            ui = ui,
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
                    if (ui.error != null) {
                        RidersFailureNotice(message = ui.error ?: "", onRetry = model::refresh)
                    }
                    if (focused && ui.step != OnboardingStep.Motorcycle) {
                        RidersSecondaryButton(label = "Back", onClick = onFinished, modifier = Modifier.fillMaxWidth())
                    } else if (!focused) {
                        Row(horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
                            if (ui.step != OnboardingStep.Profile && ui.step != OnboardingStep.Status && ui.step != OnboardingStep.Motorcycle) {
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
private fun ProfileStep(ui: OnboardingUi) {
    val onboarding = ui.onboarding ?: return
    Text("Your profile", style = RidersType.title, color = RidersColors.text)
    RidersCard {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
            Text(ui.fullName.ifBlank { "Name on your account" }, style = RidersType.heading, color = RidersColors.text)
            PhoneWithFlag(ui.phone, style = RidersType.body, color = RidersColors.textSecondary)
            Text("This phone number is verified and cannot be edited here.", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(
                profileCompletion(onboarding, ui.licence != null, ui.motorcycles.size),
                style = RidersType.body,
                color = RidersColors.text,
            )
        }
    }
}

@Composable
private fun LicenceStep(ui: OnboardingUi, onChoose: () -> Unit, onUpload: () -> Unit) {
    val onboarding = ui.onboarding ?: return
    val readiness = riderReadiness(onboarding)
    val replace = canReplaceLicence(onboarding.licenceVerificationStatus)
    Text("Driving licence", style = RidersType.title, color = RidersColors.text)
    Text("Licence ${readiness.licenceLabel}", style = RidersType.body, color = RidersColors.text)
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
                .clip(RoundedCornerShape(RidersRadius.lg)),
            contentScale = ContentScale.Crop,
        )
    } else if (ui.licence != null) {
        RidersCard {
            Text("A licence image is already uploaded.", style = RidersType.body, color = RidersColors.text)
            Text("Image review ${ui.licence.reviewStatus.lowercase().replaceFirstChar { it.titlecase() }}", style = RidersType.caption, color = RidersColors.textSecondary)
        }
    } else {
        RidersEmptyState(title = "No licence image", body = "Choose a JPEG, PNG, or WebP photo up to 5 MB.")
    }
    if (ui.uploading) {
        Text("Uploading ${ui.uploadPercent ?: 0}%", style = RidersType.caption, color = RidersColors.textSecondary)
    }
    if (replace) {
        RidersSecondaryButton(label = if (ui.licence == null) "Choose image" else "Replace image", onClick = onChoose, modifier = Modifier.fillMaxWidth())
        RidersPrimaryButton(
            label = "Upload image",
            onClick = onUpload,
            enabled = preview != null && !ui.uploading,
            loading = ui.uploading,
            loadingLabel = "Uploading",
            modifier = Modifier.fillMaxWidth(),
        )
    } else {
        Text("A verified licence cannot be replaced yet.", style = RidersType.body, color = RidersColors.textSecondary)
    }
}

@Composable
private fun MotorcycleStep(
    ui: OnboardingUi,
    onBack: () -> Unit,
    onDraft: (com.riders.rider.feature.onboarding.domain.MotorcycleDraft) -> Unit,
    onAdd: () -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onEdit: (MotorcycleDetails) -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
        Text("Motorbike", style = RidersType.title, color = RidersColors.text)
        Text(
            "Choose the motorcycle you want to use for deliveries.",
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
    }
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
    val showForm = editing || ui.addingMotorcycle
    if (!showForm) {
        RidersPrimaryButton(
            label = "Add motorbike",
            onClick = onAdd,
            modifier = Modifier.fillMaxWidth(),
        )
        RidersSecondaryButton(
            label = "Back",
            onClick = onBack,
            modifier = Modifier.fillMaxWidth(),
        )
    } else RidersCard(modifier = Modifier.fillMaxWidth()) {
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
        RidersSecondaryButton(
            label = "Cancel",
            onClick = onCancel,
            enabled = !ui.savingMotorcycle,
            modifier = Modifier.fillMaxWidth(),
        )
        RidersPrimaryButton(
            label = if (editing) "Save changes" else "Save motorcycle",
            onClick = onSave,
            enabled = !ui.savingMotorcycle,
            loading = ui.savingMotorcycle,
            loadingLabel = "Saving",
            modifier = Modifier.fillMaxWidth(),
        )
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
            .background(if (selected) Color(0xFFE4F0FB) else Color(0xFFF4F5F6))
            .border(1.dp, if (selected) Color(0xFFB7D0EA) else Color(0xFFE4E6E8), shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(RidersSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(RidersRadius.md))
                .background(if (selected) Color(0xFFD4E6F6) else Color(0xFFE8EAEC)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_mdi_motorbike),
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = RidersColors.text,
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
                    color = Color(0xFF3E6FB5),
                    modifier = Modifier
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(Color(0xFFD0E4F8))
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
            .background(if (selected) Color(0xFF4F86C8) else Color.Transparent)
            .border(2.dp, if (selected) Color(0xFF4F86C8) else RidersColors.border, CircleShape),
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
    Text("Approval status", style = RidersType.title, color = RidersColors.text)
    RidersCard {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
            Text(approvalStatusTitle(onboarding.approvalStatus), style = RidersType.heading, color = RidersColors.text)
            Text("Licence ${readiness.licenceLabel}", style = RidersType.body, color = RidersColors.text)
            Text(
                if (onboarding.activeVerifiedMotorcycle) "Motorcycle verified and active" else "Motorcycle ${if (onboarding.verifiedMotorcycleCount > 0) "verified, not active" else "not verified"}",
                style = RidersType.body,
                color = RidersColors.text,
            )
            Text(readiness.message, style = RidersType.body, color = RidersColors.text)
            Text("Availability stays offline until an approved account has a verified licence and an active verified motorcycle.", style = RidersType.caption, color = RidersColors.textSecondary)
        }
    }
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
