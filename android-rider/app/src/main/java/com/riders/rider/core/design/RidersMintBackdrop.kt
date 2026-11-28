package com.riders.rider.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp

/** Shared soft mint backdrop used by Wallet and cancelled delivery history. */
@Composable
fun RidersMintBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.clipToBounds()) {
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to RidersColors.mintStart.copy(alpha = 0.72f),
                        0.62f to RidersColors.mintMid.copy(alpha = 0.35f),
                        1f to RidersColors.mintEnd.copy(alpha = 0.55f),
                    ),
                ),
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 50.dp, y = (-90).dp)
                .size(220.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet.copy(alpha = 0.45f)),
        )
        Box(
            Modifier
                .align(Alignment.BottomStart)
                .offset(x = (-120).dp, y = 280.dp)
                .size(720.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet.copy(alpha = 0.55f)),
        )
    }
}
