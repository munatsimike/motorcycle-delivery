package com.riders.rider.feature.auth.presentation

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.core.design.RiderTheme
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.ridersFieldTextStyle
import com.riders.rider.core.design.RidersType
import com.riders.rider.BuildConfig
import com.riders.rider.R
import com.riders.rider.core.design.RidersBrandLogo
import com.riders.rider.core.design.RidersBrandMark
import com.riders.rider.core.design.PhoneWithFlag
import com.riders.rider.core.design.ZimbabweFlag
import com.riders.rider.feature.auth.domain.looksLikeDutchTestNumber
import com.riders.rider.feature.auth.domain.riderPhoneEntry

private const val OTP_LENGTH = 6
private val WelcomeBackdrop = Color(0xFFF1F7F3)

@Composable
fun WelcomeScreen(onSignIn: () -> Unit, onRegister: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(WelcomeBackdrop)
            .statusBarsPadding(),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = RidersSpacing.xxl),
            contentAlignment = Alignment.Center,
        ) {
            RidersBrandLogo()
        }
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Image(
                painter = painterResource(R.drawable.riders_motorcycle),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
                alignment = Alignment.BottomCenter,
            )
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .fillMaxHeight(0.46f)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, WelcomeBackdrop))),
            )
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth(0.62f)
                    .fillMaxHeight(0.58f)
                    .background(
                        Brush.linearGradient(
                            colors = listOf(WelcomeBackdrop, Color.Transparent),
                            start = Offset(0f, Offset.Infinite.y),
                            end = Offset(Offset.Infinite.x, 0f),
                        ),
                    ),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .background(RidersColors.background)
                .navigationBarsPadding()
                .padding(bottom = RidersSpacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Fast, Safe, and Always\nOn Time",
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(WelcomeBackdrop, RidersColors.background)))
                    .padding(horizontal = RidersSpacing.xl)
                    .padding(top = RidersSpacing.xl, bottom = RidersSpacing.md),
                style = RidersType.title,
                color = RidersColors.text,
                textAlign = TextAlign.Center,
            )
            Text(
                "Trusted motorcycle deliveries for quick\nand secure parcel transport.",
                modifier = Modifier.padding(horizontal = RidersSpacing.xl),
                style = RidersType.caption,
                color = RidersColors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(RidersSpacing.xl))
            RidersPrimaryButton(
                label = "Sign in",
                onClick = onSignIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = RidersSpacing.xl),
            )
            Spacer(Modifier.height(RidersSpacing.md))
            RidersSecondaryButton(
                label = "Create account",
                onClick = onRegister,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = RidersSpacing.xl),
            )
        }
    }
}

@Composable
fun SignInScreen(
    onCodeSent: (String) -> Unit,
    onCreateAccount: () -> Unit,
    notice: String? = null,
    model: SignInViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var phone by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(ui.completedPhone) {
        ui.completedPhone?.let(onCodeSent)
    }
    SignInContent(
        phone = phone,
        onPhone = {
            phone = it
            model.clearAccountMissing()
        },
        loading = ui.loading,
        error = ui.error ?: notice,
        codeSent = ui.completedPhone != null,
        onSubmit = { model.submit(riderPhoneEntry(phone, allowDutchTestNumbers = BuildConfig.DEBUG)) },
        onCreateAccount = onCreateAccount,
        accountMissing = ui.accountMissing,
    )
}

@Composable
fun RegisterScreen(
    onCodeSent: (String) -> Unit,
    onSignIn: () -> Unit,
    model: RegisterViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var phone by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(ui.completedPhone) {
        ui.completedPhone?.let(onCodeSent)
    }
    RegisterContent(
        phone = phone,
        onPhone = { phone = it },
        loading = ui.loading,
        error = ui.error,
        codeSent = ui.completedPhone != null,
        onSubmit = { model.submit(riderPhoneEntry(phone, allowDutchTestNumbers = BuildConfig.DEBUG)) },
        onSignIn = onSignIn,
    )
}

@Composable
fun OtpScreen(
    flow: String,
    phone: String,
    onRegistrationVerified: (String, String?, String?, Boolean) -> Unit = { _, _, _, _ -> },
    onUseExistingLogin: () -> Unit = {},
    model: OtpViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(ui.registrationToken, ui.useExistingLogin) {
        if (ui.useExistingLogin) {
            onUseExistingLogin()
        } else {
            ui.registrationToken?.let { token ->
                onRegistrationVerified(token, ui.prefillName, ui.prefillAddress, ui.lockDetails)
            }
        }
    }
    OtpContent(
        phone = phone,
        code = code,
        onCode = { code = it },
        loading = ui.loading,
        error = ui.error,
        signedIn = ui.completedPhone != null,
        onSubmit = { model.submit(flow, phone, code) },
    )
}

@Composable
private fun SignInContent(
    phone: String,
    onPhone: (String) -> Unit,
    loading: Boolean,
    error: String?,
    codeSent: Boolean,
    onSubmit: () -> Unit,
    onCreateAccount: () -> Unit,
    accountMissing: Boolean = false,
) {
    AuthScaffold {
        RidersBrandMark()
        Spacer(Modifier.height(RidersSpacing.xxxl))
        Text(
            if (accountMissing) "Rider account not found" else "Welcome back",
            style = RidersType.title,
            color = RidersColors.text,
        )
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            if (accountMissing) {
                "You don't have a rider account for this phone number. If you already have a Riders customer account, you can use the same number to register as a rider."
            } else {
                "Enter your mobile number and we'll send a one-time code."
            },
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xxl))
        ZimbabwePhoneField(
            value = phone,
            onValueChange = onPhone,
            enabled = !loading,
            countryCode = if (BuildConfig.DEBUG && looksLikeDutchTestNumber(phone)) "+31" else "+263",
        )
        if (!accountMissing) {
            Text(
                "Enter a Zimbabwe mobile number. We'll send a one-time SMS code.",
                style = RidersType.small,
                color = RidersColors.textSecondary,
            )
        }
        Spacer(Modifier.height(RidersSpacing.xl))
        AuthFeedback(error = if (accountMissing) null else error, success = if (codeSent) "Code sent" else null, onRetry = onSubmit)
        RidersPrimaryButton(
            label = if (accountMissing) "Create Rider Account" else "Continue",
            onClick = if (accountMissing) onCreateAccount else onSubmit,
            loading = loading,
            loadingLabel = "Sending",
            modifier = Modifier.fillMaxWidth(),
        )
        AuthFooter(prompt = "New to Riders?", action = "Sign up", enabled = !loading, onClick = onCreateAccount)
    }
}

@Composable
private fun RegisterContent(
    phone: String,
    onPhone: (String) -> Unit,
    loading: Boolean,
    error: String?,
    codeSent: Boolean,
    onSubmit: () -> Unit,
    onSignIn: () -> Unit,
) {
    AuthScaffold {
        RidersBrandMark()
        Spacer(Modifier.height(RidersSpacing.xxxl))
        Text("Create your account", style = RidersType.title, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            "Enter your mobile number. We'll verify it before asking for your name and address.",
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xxl))
        ZimbabwePhoneField(
            value = phone,
            onValueChange = onPhone,
            enabled = !loading,
            countryCode = if (BuildConfig.DEBUG && looksLikeDutchTestNumber(phone)) "+31" else "+263",
        )
        Text(
            "Enter a Zimbabwe mobile number. We'll send a one-time SMS code.",
            style = RidersType.small,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xl))
        AuthFeedback(error = error, success = if (codeSent) "Code sent" else null, onRetry = onSubmit)
        RidersPrimaryButton(
            label = "Verify",
            onClick = onSubmit,
            loading = loading,
            loadingLabel = "Sending",
            modifier = Modifier.fillMaxWidth(),
        )
        AuthFooter(prompt = "Already have an account?", action = "Sign in", enabled = !loading, onClick = onSignIn)
    }
}

@Composable
fun AccountScreen(model: AccountViewModel = hiltViewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf(model.initialName) }
    var address by rememberSaveable { mutableStateOf(model.initialAddress) }
    AccountContent(
        phone = model.phone,
        name = name,
        onName = { name = it },
        address = address,
        onAddress = { address = it },
        locked = model.lockDetails,
        loading = ui.loading,
        error = ui.error,
        onSubmit = { model.submit(name, address) },
    )
}

@Composable
private fun AccountContent(
    phone: String,
    name: String,
    onName: (String) -> Unit,
    address: String,
    onAddress: (String) -> Unit,
    locked: Boolean,
    loading: Boolean,
    error: String?,
    onSubmit: () -> Unit,
) {
    AuthScaffold {
        RidersBrandMark()
        Spacer(Modifier.height(RidersSpacing.xxxl))
        Text(
            if (locked) "Confirm your rider account" else "Finish your account",
            style = RidersType.title,
            color = RidersColors.text,
        )
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            if (locked) "These details come from your customer account and stay as they are."
            else "This number is verified and stays with this account.",
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xl))
        Column(
            Modifier
                .fillMaxWidth()
                .background(RidersColors.surface, RoundedCornerShape(RidersRadius.md))
                .padding(RidersSpacing.lg),
        ) {
            Text("Verified mobile number", style = RidersType.caption, color = RidersColors.textSecondary)
            Spacer(Modifier.height(RidersSpacing.xs))
            PhoneWithFlag(phone, style = RidersType.bodyStrong, color = RidersColors.text)
        }
        Spacer(Modifier.height(RidersSpacing.xl))
        RidersTextField(
            label = "Full name",
            value = name,
            onValueChange = onName,
            placeholder = "Tendai Moyo",
            enabled = !loading && !locked,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                imeAction = ImeAction.Next,
            ),
        )
        if (!locked || address.isNotBlank()) {
            RidersTextField(
                label = "Address",
                value = address,
                onValueChange = onAddress,
                placeholder = "12 Samora Machel Avenue",
                enabled = !loading && !locked,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Words,
                    imeAction = ImeAction.Done,
                ),
            )
        }
        Spacer(Modifier.height(RidersSpacing.sm))
        AuthFeedback(error = error, success = null, onRetry = onSubmit)
        RidersPrimaryButton(
            label = if (locked) "Confirm and continue" else "Create account",
            onClick = onSubmit,
            loading = loading,
            loadingLabel = if (locked) "Confirming" else "Creating",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun OtpContent(
    phone: String,
    code: String,
    onCode: (String) -> Unit,
    loading: Boolean,
    error: String?,
    signedIn: Boolean,
    onSubmit: () -> Unit,
) {
    AuthScaffold {
        Text("Verify your number", style = RidersType.title, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.md))
        Text(
            "Enter the 6-digit code from the SMS. If this number can sign in, we sent it to $phone.",
            style = RidersType.body,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.xxl))
        OtpCodeField(value = code, onValueChange = onCode, enabled = !loading, error = error != null)
        Spacer(Modifier.height(RidersSpacing.lg))
        AuthFeedback(error = error, success = if (signedIn) "Signed in" else null, onRetry = onSubmit)
        RidersPrimaryButton(
            label = "Verify",
            onClick = onSubmit,
            enabled = code.length == OTP_LENGTH,
            loading = loading,
            loadingLabel = "Checking",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun AuthFeedback(error: String?, success: String?, onRetry: (() -> Unit)? = null) {
    when {
        error != null -> {
            RidersFailureNotice(message = error, onRetry = onRetry)
            Spacer(Modifier.height(RidersSpacing.lg))
        }
        success != null -> {
            Text(
                success,
                style = RidersType.captionStrong,
                color = RidersColors.primaryDark,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(RidersSpacing.lg))
        }
    }
}

@Composable
private fun AuthFooter(prompt: String, action: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = RidersSpacing.xxl),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(prompt, style = RidersType.caption, color = RidersColors.textSecondary)
        Spacer(Modifier.width(RidersSpacing.sm))
        Text(
            action,
            style = RidersType.captionStrong,
            color = RidersColors.primary,
            modifier = Modifier
                .defaultMinSize(minHeight = 48.dp)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(vertical = RidersSpacing.md),
        )
    }
}

@Composable
private fun ZimbabwePhoneField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    countryCode: String = "+263",
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(RidersRadius.md)
    val borderColor = if (focused) RidersColors.primary else RidersColors.border
    Column(Modifier.fillMaxWidth().semantics { contentDescription = "Zimbabwe mobile number" }) {
        Text("Mobile number", style = RidersType.captionStrong, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.md))
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 58.dp)
                .shadow(
                    elevation = if (focused) 4.dp else 0.dp,
                    shape = shape,
                    ambientColor = RidersColors.focusRing,
                    spotColor = RidersColors.focusRing,
                )
                .clip(shape)
                .background(if (enabled) RidersColors.background else RidersColors.surface)
                .border(if (focused) 2.dp else 1.dp, borderColor, shape)
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (countryCode == "+263") {
                ZimbabweFlag()
                Spacer(Modifier.width(RidersSpacing.sm))
            }
            Text(
                countryCode,
                style = RidersType.bodyStrong,
                color = RidersColors.text,
                modifier = Modifier.semantics { contentDescription = "Country code $countryCode" },
            )
            Box(
                Modifier
                    .padding(horizontal = RidersSpacing.md)
                    .width(1.dp)
                    .height(24.dp)
                    .background(RidersColors.border),
            )
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier
                    .weight(1f)
                    .semantics { contentType = ContentType.PhoneNumber },
                enabled = enabled,
                textStyle = ridersFieldTextStyle(if (enabled) RidersColors.text else RidersColors.textSecondary),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                singleLine = true,
                interactionSource = interaction,
                cursorBrush = SolidColor(RidersColors.primary),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(
                                if (countryCode == "+31") "612345678" else "771234567",
                                style = ridersFieldTextStyle(RidersColors.textSecondary),
                            )
                        }
                        inner()
                    }
                },
            )
        }
        Spacer(Modifier.height(RidersSpacing.md))
    }
}

@Composable
private fun OtpCodeField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    error: Boolean,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BasicTextField(
        value = value,
        onValueChange = { next -> onValueChange(next.filter(Char::isDigit).take(OTP_LENGTH)) },
        modifier = Modifier
            .fillMaxWidth()
            .focusRequester(focus)
            .semantics {
                contentDescription = "Verification code, 6 digits"
                contentType = ContentType.SmsOtpCode
            },
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        singleLine = true,
        textStyle = ridersFieldTextStyle(Color.Transparent),
        cursorBrush = SolidColor(Color.Transparent),
        decorationBox = { inner ->
            Box {
                Box(Modifier.matchParentSize()) { inner() }
                Row(horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
                    repeat(OTP_LENGTH) { index ->
                        val active = enabled && index == value.length.coerceAtMost(OTP_LENGTH - 1) && value.length < OTP_LENGTH
                        val shape = RoundedCornerShape(RidersRadius.md)
                        val borderColor = when {
                            error -> RidersColors.error
                            active -> RidersColors.primary
                            else -> RidersColors.border
                        }
                        Box(
                            Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 56.dp)
                                .background(RidersColors.background, shape)
                                .border(if (error || active) 2.dp else 1.dp, borderColor, shape)
                                .padding(vertical = RidersSpacing.md),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                value.getOrNull(index)?.toString().orEmpty(),
                                style = ridersFieldTextStyle(RidersColors.text).copy(fontSize = RidersType.heading.fontSize),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }
        },
    )
}

@Composable
private fun AuthScaffold(content: @Composable ColumnScope.() -> Unit) {
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

@Preview(name = "Welcome", showBackground = true, widthDp = 360)
@Composable
private fun PreviewWelcome() {
    RiderTheme { WelcomeScreen(onSignIn = {}, onRegister = {}) }
}

@Preview(name = "Sign in", showBackground = true, widthDp = 360)
@Composable
private fun PreviewSignIn() {
    RiderTheme {
        SignInContent("771234567", {}, false, null, false, {}, {})
    }
}

@Preview(name = "Sign in error", showBackground = true, widthDp = 360)
@Composable
private fun PreviewSignInError() {
    RiderTheme {
        SignInContent("", {}, false, "Enter a valid Zimbabwe mobile number", false, {}, {})
    }
}

@Preview(name = "Sign in loading", showBackground = true, widthDp = 360)
@Composable
private fun PreviewSignInLoading() {
    RiderTheme {
        SignInContent("771234567", {}, true, null, false, {}, {})
    }
}

@Preview(name = "Register", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRegister() {
    RiderTheme {
        RegisterContent("771234567", {}, false, null, false, {}, {})
    }
}

@Preview(name = "Register network", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRegisterNetwork() {
    RiderTheme {
        RegisterContent(
            "771234567",
            {},
            false,
            "Network request failed. Check your connection and try again.",
            false,
            {},
            {},
        )
    }
}

@Preview(name = "OTP", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOtp() {
    RiderTheme {
        OtpContent("+263771234567", "123", {}, false, null, false, {})
    }
}

@Preview(name = "OTP invalid", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOtpInvalid() {
    RiderTheme {
        OtpContent("+263771234567", "123456", {}, false, "Verification code is invalid", false, {})
    }
}

@Preview(name = "OTP session", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOtpSession() {
    RiderTheme {
        OtpContent(
            "+263771234567",
            "123456",
            {},
            false,
            "Your session could not be saved on this device.",
            false,
            {},
        )
    }
}

@Preview(name = "OTP success", showBackground = true, widthDp = 360)
@Composable
private fun PreviewOtpSuccess() {
    RiderTheme {
        OtpContent("+263771234567", "123456", {}, false, null, true, {})
    }
}

@Preview(name = "Small phone", showBackground = true, widthDp = 320, fontScale = 1.3f)
@Composable
private fun PreviewSmallAuth() {
    RiderTheme {
        SignInContent("771234567", {}, false, null, false, {}, {})
    }
}
