package com.riders.rider.core.design

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

val LocalAppDark = compositionLocalOf { false }

private val Type = Typography(
    headlineLarge = RidersType.title,
    headlineSmall = RidersType.heading,
    titleMedium = RidersType.bodyStrong,
    bodyLarge = RidersType.body,
    bodyMedium = RidersType.caption,
    labelLarge = RidersType.button,
    labelSmall = RidersType.small,
)

@Composable
fun RiderTheme(mode: AppearanceMode = AppearanceMode.SYSTEM, content: @Composable () -> Unit) {
    val dark = when (mode) {
        AppearanceMode.DARK -> true
        AppearanceMode.LIGHT -> false
        AppearanceMode.SYSTEM -> isSystemInDarkTheme()
    }
    RidersColors.apply(dark)
    val scheme = if (dark) {
        darkColorScheme(
            primary = RidersColors.primary,
            onPrimary = RidersColors.textInverse,
            primaryContainer = RidersColors.primaryLight,
            onPrimaryContainer = RidersColors.textInverse,
            secondary = RidersColors.primary,
            onSecondary = RidersColors.textInverse,
            background = RidersColors.background,
            onBackground = RidersColors.text,
            surface = RidersColors.sheet,
            onSurface = RidersColors.text,
            onSurfaceVariant = RidersColors.textSecondary,
            outline = RidersColors.border,
            error = RidersColors.error,
            onError = RidersColors.text,
        )
    } else {
        lightColorScheme(
            primary = RidersColors.primary,
            onPrimary = RidersColors.textInverse,
            primaryContainer = RidersColors.primaryLight,
            onPrimaryContainer = RidersColors.primaryDark,
            secondary = RidersColors.primaryDark,
            onSecondary = RidersColors.textInverse,
            background = RidersColors.background,
            onBackground = RidersColors.text,
            surface = RidersColors.surface,
            onSurface = RidersColors.text,
            onSurfaceVariant = RidersColors.textSecondary,
            outline = RidersColors.border,
            error = RidersColors.error,
            onError = RidersColors.textInverse,
        )
    }
    SystemBarContrast(dark)
    CompositionLocalProvider(LocalAppDark provides dark) {
        MaterialTheme(colorScheme = scheme, typography = Type) {
            NetworkNoticeHost(content)
        }
    }
}

@Composable
private fun SystemBarContrast(dark: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) {
        return
    }
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }
}
