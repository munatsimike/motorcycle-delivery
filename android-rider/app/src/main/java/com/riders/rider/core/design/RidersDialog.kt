package com.riders.rider.core.design

import android.graphics.drawable.ColorDrawable
import android.view.ViewGroup
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

enum class RidersDialogTone {
    Primary,
    Neutral,
    Danger,
}

@Composable
fun RidersDialog(
    visible: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!visible) {
        return
    }
    val scrim = remember { MutableInteractionSource() }
    val cardTouch = remember { MutableInteractionSource() }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
        ),
    ) {
        val view = LocalView.current
        SideEffect {
            val window = (view.parent as? DialogWindowProvider)?.window ?: return@SideEffect
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window.setDimAmount(0f)
            window.setBackgroundDrawable(ColorDrawable(android.graphics.Color.TRANSPARENT))
            WindowCompat.setDecorFitsSystemWindows(window, false)
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        }
        Box(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.ime),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF17211D).copy(alpha = 0.4f))
                    .clickable(interactionSource = scrim, indication = null, onClick = onDismiss),
            )
            Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = RidersSpacing.xl)
                    .widthIn(max = 360.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(RidersRadius.xl))
                    .background(RidersColors.background)
                    .clickable(interactionSource = cardTouch, indication = null, onClick = {})
                    .padding(RidersSpacing.xl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                content = content,
            )
        }
    }
}

@Composable
fun RidersDialogTitle(text: String) {
    Text(
        text,
        style = RidersType.heading,
        color = RidersColors.text,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun RidersDialogBody(text: String) {
    Text(
        text,
        style = RidersType.body,
        color = RidersColors.textSecondary,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun RidersDialogActions(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = RidersSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
fun RidersDialogTextButton(
    label: String,
    onClick: () -> Unit,
    tone: RidersDialogTone = RidersDialogTone.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val color = when (tone) {
        RidersDialogTone.Danger -> RidersColors.error
        RidersDialogTone.Neutral -> RidersColors.textSecondary
        RidersDialogTone.Primary -> RidersColors.primary
    }
    val weight = if (tone == RidersDialogTone.Neutral) FontWeight.Medium else FontWeight.Bold
    TextButton(
        onClick = onClick,
        enabled = enabled && !loading,
        contentPadding = PaddingValues(horizontal = RidersSpacing.xs, vertical = RidersSpacing.sm),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = color,
            )
            Spacer(Modifier.width(RidersSpacing.xs))
        }
        Text(label, color = color, style = RidersType.button.copy(fontWeight = weight))
    }
}
