package com.riders.rider.feature.auth.data

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

interface BiometricCapability {
    fun strongBiometricAvailable(): Boolean
}

sealed interface BiometricAuthResult {
    data object Success : BiometricAuthResult
    data object Cancelled : BiometricAuthResult
    data class Unavailable(val message: String) : BiometricAuthResult
    data class Error(val message: String) : BiometricAuthResult
}

data class BiometricRequest(val title: String, val subtitle: String)

fun interface BiometricAuthenticator {
    fun authenticate(
        activity: FragmentActivity,
        request: BiometricRequest,
        onResult: (BiometricAuthResult) -> Unit,
    )
}

@Singleton
class AndroidBiometricCapability @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : BiometricCapability {
    override fun strongBiometricAvailable(): Boolean {
        return try {
            BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                BiometricManager.BIOMETRIC_SUCCESS
        } catch (_: Exception) {
            false
        }
    }
}

@Singleton
class AndroidBiometricPrompt @Inject constructor() : BiometricAuthenticator {
    override fun authenticate(
        activity: FragmentActivity,
        request: BiometricRequest,
        onResult: (BiometricAuthResult) -> Unit,
    ) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onResult(BiometricAuthResult.Success)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onResult(resultFor(errorCode, errString))
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(request.title)
            .setSubtitle(request.subtitle)
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(info)
    }
}

internal fun resultFor(errorCode: Int, errString: CharSequence): BiometricAuthResult {
    return when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_CANCELED,
        -> BiometricAuthResult.Cancelled
        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE,
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL,
        -> BiometricAuthResult.Unavailable(UNAVAILABLE)
        else -> BiometricAuthResult.Error(
            errString.toString().ifBlank { "Biometric unlock could not be completed." },
        )
    }
}

private const val UNAVAILABLE = "Set up fingerprint or face unlock in phone settings, then try again."
