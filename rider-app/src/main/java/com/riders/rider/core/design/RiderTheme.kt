package com.riders.rider.core.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val Colors = lightColorScheme(
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
fun RiderTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = Type) {
        NetworkNoticeHost(content)
    }
}
