package com.riders.rider.feature.wallet.presentation

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.riders.rider.R
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.wallet.domain.ECOCASH_QUICK_AMOUNTS_CENTS
import com.riders.rider.feature.wallet.domain.ECOCASH_RELEASE_BODY
import com.riders.rider.feature.wallet.domain.ECOCASH_RELEASE_TITLE
import com.riders.rider.feature.wallet.domain.EcocashSimulationState
import com.riders.rider.feature.wallet.domain.EcocashTopUpState
import com.riders.rider.feature.wallet.domain.SimulatedEcocashProvider
import com.riders.rider.feature.wallet.domain.canContinueEcocash
import com.riders.rider.feature.wallet.domain.cancelEcocash
import com.riders.rider.feature.wallet.domain.confirmEcocashDemo
import com.riders.rider.feature.wallet.domain.continueEcocash
import com.riders.rider.feature.wallet.domain.ecocashAmountLabel
import com.riders.rider.feature.wallet.domain.ecocashIdle
import com.riders.rider.feature.wallet.domain.editCustomAmount
import com.riders.rider.feature.wallet.domain.editEcocashPhone
import com.riders.rider.feature.wallet.domain.maskEcocashNumber
import com.riders.rider.feature.wallet.domain.returnToEcocashForm
import com.riders.rider.feature.wallet.domain.selectCustomAmount
import com.riders.rider.feature.wallet.domain.selectQuickAmount
import com.riders.rider.feature.wallet.domain.simulateEcocashFailure
import com.riders.rider.feature.wallet.domain.simulateEcocashSuccess

@Composable
fun EcocashTopUpSheet(
    balanceLabel: String,
    demoControls: Boolean,
    onDismiss: () -> Unit,
) {
    val provider = remember { SimulatedEcocashProvider() }
    var state by rememberSaveable(stateSaver = topUpSaver(balanceLabel)) {
        mutableStateOf(ecocashIdle(balanceLabel))
    }
    val dismiss: () -> Unit = {
        when (state.phase) {
            EcocashSimulationState.VALIDATING,
            EcocashSimulationState.FAILED,
            EcocashSimulationState.CANCELLED,
            -> state = returnToEcocashForm(state)
            EcocashSimulationState.PENDING -> state = cancelEcocash(state)
            else -> onDismiss()
        }
    }
    RidersBottomSheet(visible = true, onDismiss = dismiss) {
        if (!demoControls) {
            ReleaseTopUpNotice()
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 640.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(bottom = RidersSpacing.xl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
            ) {
                when (state.phase) {
                    EcocashSimulationState.IDLE -> TopUpForm(
                        state = state,
                        onQuick = { state = selectQuickAmount(state, it) },
                        onCustom = { state = selectCustomAmount(state) },
                        onCustomText = { state = editCustomAmount(state, it) },
                        onPhone = { state = editEcocashPhone(state, it) },
                        onContinue = { state = continueEcocash(state) },
                    )
                    EcocashSimulationState.VALIDATING -> ReviewStep(
                        state = state,
                        onBack = { state = returnToEcocashForm(state) },
                        onConfirm = { state = confirmEcocashDemo(state, provider, demoEnabled = demoControls) },
                    )
                    EcocashSimulationState.PENDING -> PendingStep(
                        state = state,
                        onClose = { state = cancelEcocash(state) },
                        onSuccess = { state = simulateEcocashSuccess(state, demoEnabled = demoControls) },
                        onFailure = { state = simulateEcocashFailure(state, demoEnabled = demoControls) },
                    )
                    EcocashSimulationState.SUCCESS -> StatusStep(
                        title = "Demo payment successful",
                        body = "Wallet balance unchanged.",
                        detail = "This simulation did not credit your wallet. Balance $balanceLabel.",
                        primary = "Back to wallet",
                        onPrimary = onDismiss,
                    )
                    EcocashSimulationState.FAILED -> StatusStep(
                        title = "Demo payment failed",
                        body = "The simulation did not change your wallet.",
                        detail = "You can run another simulation.",
                        primary = "Try another simulation",
                        onPrimary = { state = returnToEcocashForm(state) },
                        secondary = "Back to wallet",
                        onSecondary = onDismiss,
                    )
                    EcocashSimulationState.CANCELLED -> StatusStep(
                        title = "Demo payment cancelled",
                        body = "Wallet balance unchanged.",
                        detail = "No payment was sent.",
                        primary = "Back to form",
                        onPrimary = { state = returnToEcocashForm(state) },
                        secondary = "Back to wallet",
                        onSecondary = onDismiss,
                    )
                }
            }
        }
    }
}

@Composable
private fun ReleaseTopUpNotice() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = RidersSpacing.lg)
            .padding(bottom = RidersSpacing.xl),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Text(ECOCASH_RELEASE_TITLE, style = RidersType.heading, color = RidersColors.text)
        Text(ECOCASH_RELEASE_BODY, style = RidersType.body, color = RidersColors.textSecondary)
    }
}

@Composable
private fun TopUpForm(
    state: EcocashTopUpState,
    onQuick: (Long) -> Unit,
    onCustom: () -> Unit,
    onCustomText: (String) -> Unit,
    onPhone: (String) -> Unit,
    onContinue: () -> Unit,
) {

    Text("Top up wallet", style = RidersType.heading, color = RidersColors.text)
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
        Text("Payment method", style = RidersType.caption, color = RidersColors.textSecondary)
        EcoCashLogo()
    }
    Text("Amount", style = RidersType.bodyStrong, color = RidersColors.text)
    AmountChoices(state = state, onQuick = onQuick, onCustom = onCustom)
    if (state.customSelected) {
        RidersTextField(
            label = "Other amount",
            value = state.customText,
            onValueChange = onCustomText,
            placeholder = "0.00",
            error = state.amountError,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
    } else if (state.amountError != null) {
        Text(state.amountError, style = RidersType.caption, color = RidersColors.error)
    }
    RidersTextField(
        label = "EcoCash number",
        value = state.phone,
        onValueChange = onPhone,
        placeholder = "077…",
        error = state.phoneError,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
    )
    RidersPrimaryButton(
        label = "Continue",
        onClick = onContinue,
        enabled = canContinueEcocash(state),
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Continue to review the demo top-up" },
    )
}

@Composable
private fun AmountChoices(
    state: EcocashTopUpState,
    onQuick: (Long) -> Unit,
    onCustom: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
        ECOCASH_QUICK_AMOUNTS_CENTS.chunked(3).forEach { row ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                row.forEach { cents ->
                    AmountChip(
                        label = ecocashAmountLabel(cents),
                        selected = !state.customSelected && state.quickCents == cents,
                        onClick = { onQuick(cents) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(3 - row.size) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
        AmountChip(
            label = "Other",
            selected = state.customSelected,
            onClick = onCustom,
            modifier = Modifier.fillMaxWidth(),
            labelColor = RidersColors.primary,
            borderColor = RidersColors.primary.copy(alpha = 0.35f),
        )
    }
}

@Composable
private fun AmountChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    labelColor: Color? = null,
    borderColor: Color? = null,
) {
    val shape = RoundedCornerShape(RidersRadius.md)
    Text(
        label,
        style = RidersType.bodyStrong,
        color = labelColor ?: if (selected) RidersColors.primaryDark else RidersColors.text,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(shape)
            .background(if (selected) RidersColors.primaryLight else Color.Transparent)
            .border(1.dp, borderColor ?: if (selected) RidersColors.primary else RidersColors.border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = RidersSpacing.md)
            .semantics { contentDescription = if (label == "Other") "Other amount" else label },
    )
}

@Composable
private fun ReviewStep(
    state: EcocashTopUpState,
    onBack: () -> Unit,
    onConfirm: () -> Unit,
) {
    val cents = state.amountCents
    val msisdn = state.msisdn

    Text("Review top-up", style = RidersType.heading, color = RidersColors.text)
    if (cents != null) {
        DetailLine("Amount", ecocashAmountLabel(cents))
    }
    if (msisdn != null) {
        DetailLine("EcoCash number", maskEcocashNumber(msisdn))
    }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("Payment method", style = RidersType.caption, color = RidersColors.textSecondary)
        EcoCashLogo()
    }
    Text(
        "This is a simulated payment. Your wallet will not be credited.",
        style = RidersType.body,
        color = RidersColors.textSecondary,
    )
    RidersPrimaryButton(
        label = "Confirm demo payment",
        onClick = onConfirm,
        modifier = Modifier.fillMaxWidth(),
    )
    RidersSecondaryButton(label = "Back", onClick = onBack, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun PendingStep(
    state: EcocashTopUpState,
    onClose: () -> Unit,
    onSuccess: () -> Unit,
    onFailure: () -> Unit,
) {
    val cents = state.amountCents
    val msisdn = state.msisdn

    Text("Waiting for payment confirmation", style = RidersType.heading, color = RidersColors.text)
    if (cents != null) {
        DetailLine("Amount", ecocashAmountLabel(cents))
    }
    if (msisdn != null) {
        DetailLine("EcoCash number", maskEcocashNumber(msisdn))
    }
    Text(
        "No wallet credit has occurred.",
        style = RidersType.body,
        color = RidersColors.textSecondary,
    )
    RidersSecondaryButton(
        label = "Simulate success",
        onClick = onSuccess,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Simulate a demo success. The wallet balance stays unchanged." },
    )
    RidersSecondaryButton(
        label = "Simulate failure",
        onClick = onFailure,
        tone = com.riders.rider.core.design.RidersButtonTone.Danger,
        modifier = Modifier.fillMaxWidth(),
    )
    RidersSecondaryButton(label = "Close", onClick = onClose, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun StatusStep(
    title: String,
    body: String,
    detail: String,
    primary: String,
    onPrimary: () -> Unit,
    secondary: String? = null,
    onSecondary: (() -> Unit)? = null,
) {
    Text(title, style = RidersType.heading, color = RidersColors.text)
    Text(body, style = RidersType.bodyStrong, color = RidersColors.text)
    Text(detail, style = RidersType.body, color = RidersColors.textSecondary)
    RidersPrimaryButton(label = primary, onClick = onPrimary, modifier = Modifier.fillMaxWidth())
    if (secondary != null && onSecondary != null) {
        RidersSecondaryButton(label = secondary, onClick = onSecondary, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun EcoCashLogo() {
    Image(
        painter = painterResource(R.drawable.ecocash),
        contentDescription = "Payment method EcoCash",
        modifier = Modifier
            .width(108.dp)
            .height(32.dp),
        alignment = Alignment.CenterStart,
        contentScale = ContentScale.Fit,
    )
}

@Composable
private fun DetailLine(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
        Text(value, style = RidersType.bodyStrong, color = RidersColors.text)
    }
}


private fun topUpSaver(balance: String) = listSaver<EcocashTopUpState, String>(
    save = {
        listOf(
            it.phase.name,
            it.quickCents?.toString().orEmpty(),
            if (it.customSelected) "1" else "0",
            it.customText,
            it.phone,
            if (it.amountTouched) "1" else "0",
            if (it.phoneTouched) "1" else "0",
        )
    },
    restore = { saved ->
        val quick = saved[1].toLongOrNull()
        var restored = ecocashIdle(balance).copy(
            phase = runCatching { EcocashSimulationState.valueOf(saved[0]) }.getOrDefault(EcocashSimulationState.IDLE),
            quickCents = quick,
            customSelected = saved[2] == "1",
            customText = saved[3],
            phone = saved[4],
            amountTouched = saved[5] == "1",
            phoneTouched = saved[6] == "1",
        )
        restored = if (restored.customSelected) {
            editCustomAmount(restored.copy(phase = EcocashSimulationState.IDLE), restored.customText)
                .copy(phase = restored.phase, amountTouched = restored.amountTouched, phoneTouched = restored.phoneTouched)
        } else if (quick != null) {
            selectQuickAmount(restored.copy(phase = EcocashSimulationState.IDLE), quick)
                .copy(phase = restored.phase)
        } else {
            restored
        }
        if (restored.phase == EcocashSimulationState.IDLE || restored.phone.isBlank()) {
            restored.copy(msisdn = null)
        } else {
            val msisdn = runCatching { com.riders.rider.feature.wallet.domain.normalizeEcocashMsisdn(restored.phone) }.getOrNull()
            if (msisdn == null || restored.amountCents == null) {
                restored.copy(phase = EcocashSimulationState.IDLE, msisdn = null)
            } else {
                restored.copy(msisdn = msisdn)
            }
        }
    },
)
