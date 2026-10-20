package com.riders.rider.feature.auth.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark

@Composable
fun BiometricUnlockScreen(model: SessionViewModel) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findFragmentActivity()
    var prompted by remember { mutableStateOf(false) }
    LaunchedEffect(ui.canUnlock) {
        if (ui.canUnlock && !prompted && activity != null) {
            prompted = true
            model.unlock(activity)
        }
    }
    BiometricUnlockContent(
        canUnlock = ui.canUnlock,
        error = ui.error,
        working = ui.working,
        onUnlock = { activity?.let(model::unlock) },
        onUsePhone = model::usePhoneNumber,
    )
}

@Composable
fun BiometricOfferScreen(model: SessionViewModel) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findFragmentActivity()
    BiometricOfferContent(
        error = ui.error,
        working = ui.working,
        onEnable = { activity?.let(model::enable) },
        onDecline = model::decline,
    )
}

@Composable
private fun BiometricUnlockContent(
    canUnlock: Boolean,
    error: String?,
    working: Boolean,
    onUnlock: () -> Unit,
    onUsePhone: () -> Unit,
) {
    BiometricScaffold {
        RidersWordmark()
        Spacer(Modifier.height(RidersSpacing.xxxl))
        Text(
            if (canUnlock) "Unlock Riders" else "Sign in again",
            style = RidersType.title,
            color = RidersColors.text,
        )
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            if (canUnlock) {
                "Confirm it is you to open the session already stored on this phone."
            } else {
                "Biometric unlock is no longer available on this phone."
            },
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xxl))
        if (error != null) {
            RidersErrorState(message = error)
            Spacer(Modifier.height(RidersSpacing.lg))
        }
        if (canUnlock) {
            RidersPrimaryButton(
                label = "Unlock",
                onClick = onUnlock,
                loading = working,
                loadingLabel = "Waiting",
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(RidersSpacing.md))
        }
        RidersSecondaryButton(
            label = "Use phone number instead",
            onClick = onUsePhone,
            enabled = !working,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
        )
    }
}

@Composable
private fun BiometricOfferContent(
    error: String?,
    working: Boolean,
    onEnable: () -> Unit,
    onDecline: () -> Unit,
) {
    BiometricScaffold {
        RidersWordmark()
        Spacer(Modifier.height(RidersSpacing.xxxl))
        Text("Sign in faster next time", style = RidersType.title, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            "Use fingerprint or face unlock to open Riders on this phone. You can still use your phone number later.",
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xxl))
        if (error != null) {
            RidersErrorState(message = error)
            Spacer(Modifier.height(RidersSpacing.lg))
        }
        RidersPrimaryButton(
            label = "Enable",
            onClick = onEnable,
            loading = working,
            loadingLabel = "Waiting",
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(RidersSpacing.md))
        RidersSecondaryButton(
            label = "Not now",
            onClick = onDecline,
            enabled = !working,
            modifier = Modifier.fillMaxWidth(),
            soft = false,
        )
    }
}

fun Context.findFragmentActivity(): FragmentActivity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is FragmentActivity) {
            return current
        }
        current = current.baseContext
    }
    return null
}

@Composable
private fun BiometricScaffold(content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(RidersColors.background)) {
        val horizontal = if (maxWidth < 360.dp) RidersSpacing.lg else RidersSpacing.xl
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = horizontal)
                .padding(top = RidersSpacing.lg, bottom = RidersSpacing.xxl),
            content = content,
        )
    }
}

@Preview(name = "Unlock", showBackground = true, widthDp = 360)
@Composable
private fun PreviewUnlock() {
    RiderTheme { BiometricUnlockContent(true, null, false, {}, {}) }
}

@Preview(name = "Unlock cancelled", showBackground = true, widthDp = 360)
@Composable
private fun PreviewUnlockCancelled() {
    RiderTheme { BiometricUnlockContent(true, "Biometric unlock was cancelled.", false, {}, {}) }
}

@Preview(name = "Biometric unavailable", showBackground = true, widthDp = 360)
@Composable
private fun PreviewBiometricUnavailable() {
    RiderTheme { BiometricUnlockContent(false, null, false, {}, {}) }
}

@Preview(name = "Biometric offer", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOffer() {
    RiderTheme { BiometricOfferContent(null, false, {}, {}) }
}
