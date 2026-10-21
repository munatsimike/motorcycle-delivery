package com.riders.rider.feature.onboarding.presentation

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPrimaryButton
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
            if (!focused) {
                Text("Step ${ui.step.ordinal + 1} of 4", style = RidersType.caption, color = RidersColors.textSecondary)
            }
            when {
                ui.loading && ui.onboarding == null -> RidersLoadingState("Loading your account")
                ui.onboarding == null -> RidersErrorState(
                    title = "Account unavailable",
                    message = ui.error ?: "Your account could not be loaded. Check your connection and try again.",
                    retryLabel = "Try again",
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
                            onDraft = model::updateDraft,
                            onSave = model::saveMotorcycle,
                            onEdit = model::editMotorcycle,
                            onSelect = model::selectMotorcycle,
                        )
                        OnboardingStep.Status -> StatusStep(ui, onRefresh = model::refresh, onHome = onFinished)
                    }
                    if (ui.error != null) {
                        RidersErrorState(message = ui.error ?: "")
                    }
                    if (focused) {
                        RidersSecondaryButton(label = "Back", onClick = onFinished, modifier = Modifier.fillMaxWidth())
                    } else {
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

@Composable
private fun ProfileStep(ui: OnboardingUi) {
    val onboarding = ui.onboarding ?: return
    Text("Your profile", style = RidersType.title, color = RidersColors.text)
    RidersCard {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
            Text(ui.fullName.ifBlank { "Name on your account" }, style = RidersType.heading, color = RidersColors.text)
            Text("Phone ${ui.phone}", style = RidersType.body, color = RidersColors.textSecondary)
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
    onDraft: (com.riders.rider.feature.onboarding.domain.MotorcycleDraft) -> Unit,
    onSave: () -> Unit,
    onEdit: (MotorcycleDetails) -> Unit,
    onSelect: (String) -> Unit,
) {
    Text("Motorcycle", style = RidersType.title, color = RidersColors.text)
    if (ui.motorcycles.isEmpty()) {
        RidersEmptyState(title = "No motorcycle yet", body = "Add the motorcycle you will use for deliveries.")
    }
    ui.motorcycles.forEach { motorcycle ->
        RidersCard {
            Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                Text(motorcycle.registrationNumber, style = RidersType.heading, color = RidersColors.text)
                Text("${motorcycle.make} ${motorcycle.model}", style = RidersType.body, color = RidersColors.text)
                Text(motorcycle.colour, style = RidersType.caption, color = RidersColors.textSecondary)
                Text(motorcycleStatusTitle(motorcycle.verificationStatus), style = RidersType.body, color = RidersColors.text)
                if (motorcycle.isActive) {
                    Text("Active motorcycle", style = RidersType.caption, color = RidersColors.primaryDark)
                }
                if (canEditMotorcycle(motorcycle.verificationStatus)) {
                    RidersSecondaryButton(label = "Edit", onClick = { onEdit(motorcycle) }, modifier = Modifier.fillMaxWidth())
                }
                if (canSelectMotorcycle(motorcycle.verificationStatus, motorcycle.isActive)) {
                    RidersPrimaryButton(label = "Use this motorcycle", onClick = { onSelect(motorcycle.id) }, enabled = !ui.savingMotorcycle, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
    Text(if (ui.editingId == null) "Add a motorcycle" else "Update motorcycle", style = RidersType.heading, color = RidersColors.text)
    RidersTextField(label = "Registration number", value = ui.draft.registrationNumber, onValueChange = { onDraft(ui.draft.copy(registrationNumber = it)) })
    RidersTextField(label = "Make", value = ui.draft.make, onValueChange = { onDraft(ui.draft.copy(make = it)) })
    RidersTextField(label = "Model", value = ui.draft.model, onValueChange = { onDraft(ui.draft.copy(model = it)) })
    RidersTextField(label = "Colour", value = ui.draft.colour, onValueChange = { onDraft(ui.draft.copy(colour = it)) })
    RidersPrimaryButton(
        label = if (ui.editingId == null) "Save motorcycle" else "Save changes",
        onClick = onSave,
        loading = ui.savingMotorcycle,
        loadingLabel = "Saving",
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun StatusStep(ui: OnboardingUi, onRefresh: () -> Unit, onHome: () -> Unit) {
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
    RidersSecondaryButton(label = "Refresh status", onClick = onRefresh, modifier = Modifier.fillMaxWidth())
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
