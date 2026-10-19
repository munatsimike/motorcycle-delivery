package com.riders.rider.core.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Green = Color(0xFF169B62)
private val GreenDark = Color(0xFF087A4A)
private val Background = Color(0xFFFFFFFF)
private val Text = Color(0xFF17211D)

private val Colors = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE9F8EF),
    secondary = GreenDark,
    background = Background,
    surface = Color(0xFFF1FAF5),
    onBackground = Text,
    onSurface = Text,
    error = Color(0xFFD92D20),
)

@Composable
fun RiderTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, content = content)
}
