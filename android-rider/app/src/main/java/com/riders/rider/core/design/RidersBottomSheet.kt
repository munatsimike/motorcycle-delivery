package com.riders.rider.core.design

import android.graphics.drawable.ColorDrawable
import android.view.ViewGroup
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider

private const val OPEN_MS = 360
private const val CLOSE_MS = 280
private val SheetTravel = 900.dp

@Composable
fun RidersBottomSheet(
    visible: Boolean,
    onDismiss: () -> Unit,
    handle: Boolean = true,
    content: @Composable () -> Unit,
) {
    val progress = remember { Animatable(if (visible) 1f else 0f) }
    var render by remember { mutableStateOf(visible) }
    if (visible && !render) {
        render = true
    }
    LaunchedEffect(visible) {
        if (visible) {
            progress.animateTo(1f, tween(OPEN_MS, easing = FastOutSlowInEasing))
        } else if (render) {
            progress.animateTo(0f, tween(CLOSE_MS, easing = FastOutSlowInEasing))
            render = false
        }
    }
    if (!render) {
        return
    }
    val shape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
    val travel = with(LocalDensity.current) { SheetTravel.toPx() }
    val scrim = remember { MutableInteractionSource() }
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
        }
        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF17211D).copy(alpha = 0.55f * progress.value))
                    .clickable(interactionSource = scrim, indication = null, onClick = onDismiss),
            )
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .graphicsLayer { translationY = (1f - progress.value) * travel }
                    .clip(shape)
                    .background(RidersColors.background),
            ) {
                if (handle) {
                    Box(
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(top = RidersSpacing.sm, bottom = RidersSpacing.sm)
                            .width(36.dp)
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(RidersColors.border),
                    )
                }
                content()
            }
        }
    }
}
