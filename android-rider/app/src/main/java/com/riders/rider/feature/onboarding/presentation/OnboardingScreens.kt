package com.riders.rider.feature.onboarding.presentation

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
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
import com.riders.rider.core.design.RidersMotion
import com.riders.rider.core.design.rememberRidersMotion
import com.riders.rider.core.design.RidersButtonTone
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
import com.riders.rider.feature.onboarding.domain.previousOnboardingStep
import com.riders.rider.feature.onboarding.domain.riderReadiness
import com.riders.rider.core.io.readAtMost
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
    LaunchedEffect(ui.step, ui.loading, ui.refreshing, ui.addingMotorcycle, ui.editingId, ui.motorcycles) {
        if (focused || ui.loading || ui.refreshing || ui.onboarding == null) {
            return@LaunchedEffect
        }
        if (ui.step != OnboardingStep.Motorcycle || ui.addingMotorcycle || ui.editingId != null) {
            return@LaunchedEffect
        }
        val existing = ui.motorcycles.firstOrNull { it.isActive } ?: ui.motorcycles.firstOrNull()
        if (existing != null) {
            model.editMotorcycle(existing)
        } else {
            model.beginAddMotorcycle()
        }
    }
    val motorcycleForm = ui.onboarding != null && ui.step == OnboardingStep.Motorcycle && (
        !focused || ui.editingId != null || ui.addingMotorcycle
        )
    val showBackHeader = ui.onboarding != null && !(motorcycleForm && focused)
    RiderTheme {
        Column(
            Modifier
                .fillMaxSize()
                .background(RidersColors.background)
                .statusBarsPadding(),
        ) {
        if (showBackHeader) {
            val leave = focused || ui.step == OnboardingStep.Profile
            OnboardingBackHeader(
                label = backStepLabel(ui.step, focused),
                onClick = if (leave) onFinished else model::back,
            )
        }
        RidersPullRefresh(
            refreshing = ui.refreshing,
            onRefresh = model::refresh,
            modifier = Modifier
                .weight(1f)
                .navigationBarsPadding()
                .imePadding(),
        ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.lg),
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
                        )
                        OnboardingStep.Motorcycle -> MotorcycleStep(
                            ui = ui,
                            registration = !focused,
                            onDraft = model::updateDraft,
                            onAdd = model::beginAddMotorcycle,
                            onSave = model::saveMotorcycle,
                            onContinue = model::continueStep,
                            onCancel = model::cancelMotorcycleEdit,
                            onEdit = model::editMotorcycle,
                            onSelect = model::selectMotorcycle,
                        )
                        OnboardingStep.Status -> StatusStep(ui, onHome = onFinished)
                    }
                    if (ui.step != OnboardingStep.Motorcycle) {
                        ui.notice?.let { SavedNotice(it) }
                    }
                    if (ui.error != null) {
                        RidersFailureNotice(message = ui.error ?: "", onRetry = model::refresh)
                    }
                    if (!focused && !motorcycleForm && ui.step != OnboardingStep.Status) {
                        val licenceUploaded = ui.licence != null || ui.onboarding?.licenceVerificationStatus == "VERIFIED"
                        RidersPrimaryButton(
                            label = "Continue",
                            onClick = model::continueStep,
                            enabled = !ui.savingMotorcycle && !ui.uploading && (ui.step != OnboardingStep.Licence || licenceUploaded),
                            loading = ui.savingMotorcycle,
                            loadingLabel = "Saving",
                            modifier = Modifier.fillMaxWidth(),
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
private fun OnboardingBackHeader(label: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(RidersColors.background)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(56.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(end = RidersSpacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_left),
                contentDescription = "Back",
                modifier = Modifier.size(48.dp).padding(12.dp),
                tint = RidersColors.text,
            )
            Text(
                label,
                style = RidersType.heading.copy(fontWeight = FontWeight.SemiBold),
                color = RidersColors.text,
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(RidersColors.border))
    }
}

private fun backStepLabel(step: OnboardingStep, focused: Boolean): String {
    if (focused) {
        return "Your profile"
    }
    return when (previousOnboardingStep(step)) {
        null -> "Home"
        OnboardingStep.Profile -> "Your profile"
        OnboardingStep.Licence -> "Driving licence"
        OnboardingStep.Motorcycle -> "Motorbike"
        OnboardingStep.Status -> "Approval status"
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
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = RidersColors.text,
            modifier = Modifier.size(22.dp),
        )
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
                .size(40.dp)
                .clip(RoundedCornerShape(8.dp))
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
private fun LicenceStep(ui: OnboardingUi, onPick: () -> Unit) {
    val onboarding = ui.onboarding ?: return
    val replace = canReplaceLicence(onboarding.licenceVerificationStatus)
    val licence = ui.licence
    val loaded = licence != null && !ui.uploading
    val rejected = licence?.reviewStatus == "REJECTED"
    StepHeading(
        title = "Driving licence",
        subtitle = "Choose a clear photo of your driving licence.",
    )
    if (onboarding.rejectionReason != null) {
        Text(onboarding.rejectionReason, style = RidersType.caption, color = RidersColors.error)
    }
    RidersCard(
        prominent = true,
        onClick = if (replace && !ui.uploading) onPick else null,
        containerColor = when {
            !loaded -> RidersColors.background
            rejected -> RidersColors.dangerSurface
            else -> RidersColors.primaryLight
        },
        borderColor = when {
            !loaded -> RidersColors.border
            rejected -> RidersColors.error
            else -> RidersColors.primary
        },
    ) {
        Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            if (licence != null) {
                LicenceStatusBadge(licence.reviewStatus, licenceReviewLabel(licence.reviewStatus))
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
                if (loaded && !rejected) {
                    IconTile(R.drawable.ic_check, RidersColors.primaryDark, RidersColors.background)
                } else {
                    IconTile(R.drawable.ic_card, Color(0xFF3D5A80), Color(0xFFEEF2F6))
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                    Text("Driving licence", style = RidersType.caption, color = RidersColors.textSecondary)
                    Text(
                        when {
                            ui.uploading -> "Uploading ${ui.uploadPercent ?: 0}%"
                            loaded -> "Licence loaded"
                            else -> "Tap to upload licence"
                        },
                        style = RidersType.bodyStrong,
                        color = if (loaded && !rejected) RidersColors.primaryDark else RidersColors.text,
                    )
                }
            }
            if (loaded && replace) {
                Text(
                    "Tap to replace",
                    style = RidersType.small,
                    color = RidersColors.textSecondary,
                )
            }
        }
    }
    if (!replace) {
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
    onDraft: (com.riders.rider.feature.onboarding.domain.MotorcycleDraft) -> Unit,
    onAdd: () -> Unit,
    onSave: () -> Unit,
    onContinue: () -> Unit,
    onCancel: () -> Unit,
    onEdit: (MotorcycleDetails) -> Unit,
    onSelect: (String) -> Unit,
) {
    StepHeading(
        title = "Motorbike",
        subtitle = if (registration) {
            "Add the motorcycle you want to use, then continue."
        } else {
            "Add the motorbike you want to use and save."
        },
    )
    if (!registration) {
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
    }
    if (!registration) {
        ui.notice?.let { SavedNotice(it) }
    }
    val editing = ui.editingId != null
    val showForm = registration || editing || ui.addingMotorcycle
    val motion = rememberRidersMotion()
    val appearMs = motion.duration(RidersMotion.DELIVERY_MS)
    val hideMs = motion.duration(RidersMotion.CONFIRM_MS)
    val formEnter = fadeIn(tween(appearMs, easing = FastOutSlowInEasing)) +
        expandVertically(tween(appearMs, easing = FastOutSlowInEasing), expandFrom = Alignment.Top) +
        scaleIn(tween(appearMs, easing = FastOutSlowInEasing), initialScale = 0.96f)
    val formExit = fadeOut(tween(hideMs)) +
        shrinkVertically(tween(hideMs), shrinkTowards = Alignment.Top) +
        scaleOut(tween(hideMs), targetScale = 0.96f)
    AnimatedVisibility(
        visible = !showForm,
        enter = formEnter,
        exit = fadeOut(tween(hideMs)) + shrinkVertically(tween(hideMs), shrinkTowards = Alignment.Top),
    ) {
        if (registration && ui.motorcycles.isNotEmpty()) {
            RidersSecondaryButton(
                label = "Add motorbike",
                onClick = onAdd,
                icon = R.drawable.ic_plus,
                bordered = false,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            RidersPrimaryButton(
                label = "Add motorbike",
                onClick = onAdd,
                icon = R.drawable.ic_plus,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    AnimatedVisibility(
        visible = showForm,
        enter = formEnter,
        exit = formExit,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg)) {
        RidersCard(modifier = Modifier.fillMaxWidth(), prominent = true) {
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
            RidersPrimaryButton(
                label = if (registration) "Continue" else if (editing) "Save changes" else "Save bike",
                onClick = if (registration) onContinue else onSave,
                enabled = !ui.savingMotorcycle,
                loading = ui.savingMotorcycle,
                loadingLabel = "Saving",
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (!registration) {
            RidersSecondaryButton(
                label = "Cancel",
                onClick = onCancel,
                enabled = !ui.savingMotorcycle,
                tone = RidersButtonTone.Danger,
                bordered = false,
                modifier = Modifier.fillMaxWidth(),
            )
        }
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
    val pending = motorcycle.verificationStatus != "VERIFIED" &&
        motorcycle.verificationStatus != "REJECTED" &&
        motorcycle.verificationStatus != "REVOKED"
    val approved = motorcycle.verificationStatus == "VERIFIED"
    val shape = RoundedCornerShape(RidersRadius.lg)
    val cardFill = when {
        pending -> Color(0xFFFFF4E5)
        approved && selected -> ActiveFill
        approved -> InactiveFill
        selected -> RidersColors.primaryLight
        else -> RidersColors.surface
    }
    val cardBorder = when {
        pending -> Color(0xFFF3D7A1)
        approved && selected -> ActiveBorder
        approved -> InactiveBorder
        selected -> ActiveBorder
        else -> RidersColors.border
    }
    Row(
        Modifier
            .fillMaxWidth()
            .shadow(
                elevation = if (enabled) 6.dp else 0.dp,
                shape = shape,
                ambientColor = RidersColors.shadow,
                spotColor = RidersColors.shadow,
            )
            .clip(shape)
            .background(cardFill)
            .border(1.dp, cardBorder, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(RidersSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(RidersRadius.md))
                .background(
                    when {
                        pending -> Color(0xFFFFE8C2)
                        approved && selected -> Color(0xFFFFFFFF)
                        approved -> Color(0xFFE6E8EB)
                        selected -> RidersColors.background
                        else -> Color(0xFFDDF3E8)
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_mdi_motorbike),
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = when {
                    pending -> Color(0xFFB86E00)
                    approved && selected -> ActiveGreen
                    approved -> InactiveGrey
                    else -> RidersColors.primaryDark
                },
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
                Text(
                    motorcycleStatusTitle(motorcycle.verificationStatus),
                    style = RidersType.caption,
                    color = if (pending) Color(0xFFB86E00) else RidersColors.textSecondary,
                )
            }
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            SelectionMark(
                selected = selected,
                color = if (approved) ActiveGreen else RidersColors.primary,
                idle = if (approved) InactiveGrey else RidersColors.border,
            )
            if (selected) {
                Text(
                    "Active",
                    style = RidersType.captionStrong,
                    color = if (approved) ActiveGreen else RidersColors.primaryDark,
                    modifier = Modifier
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(RidersColors.background)
                        .padding(horizontal = RidersSpacing.sm, vertical = 2.dp),
                )
            }
        }
    }
}

private val ActiveFill = Color(0xFFD4EFE0)
private val ActiveBorder = Color(0xFFB7DCC8)
private val ActiveGreen = RidersColors.primary
private val InactiveFill = Color(0xFFF3F4F6)
private val InactiveBorder = Color(0xFFD8DDE3)
private val InactiveGrey = Color(0xFF9AA3AB)

@Composable
private fun SelectionMark(selected: Boolean, color: Color, idle: Color) {
    val mark = if (selected) color else idle
    Box(
        Modifier
            .size(22.dp)
            .clip(CircleShape)
            .background(if (selected) color else Color.Transparent)
            .border(2.dp, mark, CircleShape),
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
        )
        StatusLine(
            icon = R.drawable.ic_card,
            label = "Driving licence",
            value = readiness.licenceLabel,
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
        )
    }
    Text(readiness.message, style = RidersType.body, color = RidersColors.text)
    RidersPrimaryButton(label = "Done", onClick = onHome, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(RidersSpacing.sm))
}

private fun readLicence(resolver: android.content.ContentResolver, uri: Uri): ByteArray? {
    return try {
        resolver.openInputStream(uri)?.use { stream -> readAtMost(stream, LICENCE_IMAGE_MAX_BYTES + 1) }
    } catch (_: SecurityException) {
        null
    }
}

