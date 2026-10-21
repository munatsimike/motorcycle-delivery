package com.riders.rider.feature.profile.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.auth.presentation.SessionViewModel
import com.riders.rider.feature.auth.presentation.findFragmentActivity
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.canEditMotorcycle
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.canSelectMotorcycle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.feature.onboarding.domain.riderReadiness

@Composable
fun ProfileScreen(
    onLicence: () -> Unit,
    onMotorcycles: () -> Unit,
    onWallet: () -> Unit,
    model: ProfileViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = context.findFragmentActivity()
        ?: error("Profile requires the rider activity")
    val session: SessionViewModel = hiltViewModel(activity)
    val sessionUi by session.ui.collectAsStateWithLifecycle()
    var confirmLogoutAll by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { model.refresh(force = false) }
    if (confirmLogoutAll) {
        AlertDialog(
            onDismissRequest = { confirmLogoutAll = false },
            title = { Text("Log out of all devices?", style = RidersType.heading, color = RidersColors.text) },
            text = {
                Text(
                    "This signs you out of Riders on every device, including this phone.",
                    style = RidersType.body,
                    color = RidersColors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogoutAll = false
                    model.logoutAll()
                }) { Text("Log out") }
            },
            dismissButton = {
                TextButton(onClick = { confirmLogoutAll = false }) { Text("Cancel") }
            },
        )
    }
    ui.logoutNotice?.let { notice ->
        AlertDialog(
            onDismissRequest = model::acknowledgeLogoutNotice,
            title = { Text("Signed out on this phone", style = RidersType.heading, color = RidersColors.text) },
            text = { Text(notice, style = RidersType.body, color = RidersColors.textSecondary) },
            confirmButton = {
                TextButton(onClick = model::acknowledgeLogoutNotice) { Text("OK") }
            },
        )
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        RidersWordmark()
        Text("Profile", style = RidersType.title, color = RidersColors.text)
        when {
            ui.loading && ui.board.onboarding == null && ui.board.fullName.isBlank() -> RidersLoadingState("Loading your profile")
            ui.board.onboarding == null && ui.board.fullName.isBlank() && ui.board.error != null -> RidersErrorState(
                title = "Profile unavailable",
                message = ui.board.error.orEmpty(),
                retryLabel = "Refresh",
                onRetry = { model.refresh(force = true) },
            )
            else -> {
                Header(ui.board.fullName, ui.board.phone, ui.board.onboarding)
                if (ui.board.error != null) {
                    RidersErrorState(message = ui.board.error.orEmpty(), retryLabel = "Refresh", onRetry = { model.refresh(force = true) })
                }
                PersonalSection(ui.board.fullName, ui.board.phone, ui.board.address)
                LicenceSection(ui.board.onboarding, ui.board.hasLicence, onLicence)
                MotorcycleSection(ui.board.motorcycles, onMotorcycles)
                ui.board.onboarding?.let { VerificationSection(it) }
                RidersCard(onClick = onWallet, modifier = Modifier.fillMaxWidth()) {
                    Text("Wallet", style = RidersType.bodyStrong, color = RidersColors.text)
                    Text("Open your wallet", style = RidersType.caption, color = RidersColors.textSecondary)
                }
                AccountSection(
                    biometricAction = sessionUi.biometricAction,
                    biometricError = sessionUi.error,
                    signingOut = ui.signingOut,
                    onBiometric = { session.onHomeBiometric(activity) },
                    onLogout = model::logout,
                    onLogoutAll = { confirmLogoutAll = true },
                )
                RidersSecondaryButton(
                    label = "Refresh",
                    onClick = { model.refresh(force = true) },
                    enabled = !ui.loading && !ui.signingOut,
                    modifier = Modifier.fillMaxWidth(),
                    soft = false,
                )
            }
        }
    }
}

@Composable
private fun Header(name: String, phone: String, onboarding: RiderOnboarding?) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text(name.ifBlank { "Rider" }, style = RidersType.heading, color = RidersColors.text)
        if (phone.isNotBlank()) {
            Text(phone, style = RidersType.body, color = RidersColors.textSecondary)
        }
        if (onboarding != null) {
            Text(approvalStatusTitle(onboarding.approvalStatus), style = RidersType.captionStrong, color = RidersColors.primaryDark)
        }
    }
}

@Composable
private fun PersonalSection(name: String, phone: String, address: String) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Personal information", style = RidersType.bodyStrong, color = RidersColors.text)
        Text(name.ifBlank { "Name on your account" }, style = RidersType.body, color = RidersColors.text)
        Text(phone.ifBlank { "Verified phone" }, style = RidersType.body, color = RidersColors.textSecondary)
        if (address.isNotBlank()) {
            Text(address, style = RidersType.body, color = RidersColors.textSecondary)
        }
        Text("This phone number is verified and cannot be edited here.", style = RidersType.caption, color = RidersColors.textSecondary)
    }
}

@Composable
private fun LicenceSection(onboarding: RiderOnboarding?, hasLicence: Boolean, onOpen: () -> Unit) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Driving licence", style = RidersType.bodyStrong, color = RidersColors.text)
        if (onboarding != null) {
            val readiness = riderReadiness(onboarding)
            Text(readiness.licenceLabel, style = RidersType.body, color = RidersColors.text)
            onboarding.licenceNumber?.takeIf { it.isNotBlank() }?.let {
                Text("Licence number $it", style = RidersType.caption, color = RidersColors.textSecondary)
            }
            onboarding.licenceClass?.takeIf { it.isNotBlank() }?.let {
                Text("Class $it", style = RidersType.caption, color = RidersColors.textSecondary)
            }
            onboarding.rejectionReason?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = RidersType.caption, color = RidersColors.error)
            }
            if (!canReplaceLicence(onboarding.licenceVerificationStatus)) {
                Text("A verified licence cannot be replaced yet.", style = RidersType.caption, color = RidersColors.textSecondary)
            } else if (!hasLicence) {
                Text("No licence image uploaded yet.", style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        RidersSecondaryButton(label = "Open licence", onClick = onOpen, modifier = Modifier.fillMaxWidth(), soft = false)
    }
}

@Composable
private fun MotorcycleSection(motorcycles: List<MotorcycleDetails>, onOpen: () -> Unit) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("My motorcycles", style = RidersType.bodyStrong, color = RidersColors.text)
        if (motorcycles.isEmpty()) {
            Text("No motorcycle yet", style = RidersType.body, color = RidersColors.textSecondary)
        }
        motorcycles.forEach { motorcycle ->
            Text(motorcycle.registrationNumber, style = RidersType.bodyStrong, color = RidersColors.text)
            Text("${motorcycle.make} ${motorcycle.model}", style = RidersType.body, color = RidersColors.text)
            Text(motorcycle.colour, style = RidersType.caption, color = RidersColors.textSecondary)
            Text(motorcycleStatusTitle(motorcycle.verificationStatus), style = RidersType.caption, color = RidersColors.text)
            if (motorcycle.isActive) {
                Text("Active motorcycle", style = RidersType.caption, color = RidersColors.primaryDark)
            }
            if (canEditMotorcycle(motorcycle.verificationStatus)) {
                Text("This motorcycle can be updated.", style = RidersType.caption, color = RidersColors.textSecondary)
            }
            if (canSelectMotorcycle(motorcycle.verificationStatus, motorcycle.isActive)) {
                Text("This verified motorcycle can be selected.", style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        RidersSecondaryButton(label = "Manage motorcycles", onClick = onOpen, modifier = Modifier.fillMaxWidth(), soft = false)
    }
}

@Composable
private fun VerificationSection(onboarding: RiderOnboarding) {
    val readiness = riderReadiness(onboarding)
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Account verification", style = RidersType.bodyStrong, color = RidersColors.text)
        Text("Approval ${readiness.approvalLabel}", style = RidersType.body, color = RidersColors.text)
        Text("Licence ${readiness.licenceLabel}", style = RidersType.body, color = RidersColors.text)
        Text(
            if (onboarding.activeVerifiedMotorcycle) "Motorcycle verified and active" else "Motorcycle ${if (onboarding.verifiedMotorcycleCount > 0) "verified, not active" else "not verified"}",
            style = RidersType.body,
            color = RidersColors.text,
        )
        Text(readiness.message, style = RidersType.caption, color = RidersColors.textSecondary)
    }
}

@Composable
private fun AccountSection(
    biometricAction: String?,
    biometricError: String?,
    signingOut: Boolean,
    onBiometric: () -> Unit,
    onLogout: () -> Unit,
    onLogoutAll: () -> Unit,
) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Account and security", style = RidersType.bodyStrong, color = RidersColors.text)
        if (biometricError != null) {
            RidersErrorState(message = biometricError)
        }
        if (biometricAction != null) {
            RidersSecondaryButton(
                label = biometricAction,
                onClick = onBiometric,
                enabled = !signingOut,
                modifier = Modifier.fillMaxWidth(),
                soft = false,
            )
        }
        RidersSecondaryButton(
            label = "Log out",
            onClick = onLogout,
            enabled = !signingOut,
            loading = signingOut,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
        )
        RidersSecondaryButton(
            label = "Log out of all devices",
            onClick = onLogoutAll,
            enabled = !signingOut,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
        )
    }
}
