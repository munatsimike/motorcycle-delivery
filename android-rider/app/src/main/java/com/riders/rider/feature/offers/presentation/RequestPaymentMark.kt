package com.riders.rider.feature.offers.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.offers.domain.requestPaymentBadge

@Composable
fun RequestPaymentMark(method: String?, modifier: Modifier = Modifier) {
    val label = requestPaymentBadge(method) ?: return
    val (background, foreground) = paymentBadgeColors(label, LocalAppDark.current)
    Text(
        label,
        modifier = modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(background)
            .padding(horizontal = RidersSpacing.sm, vertical = 2.dp),
        style = RidersType.captionStrong,
        color = foreground,
        maxLines = 1,
    )
}

private fun paymentBadgeColors(label: String, dark: Boolean): Pair<Color, Color> {
    if (label == "EcoCash") {
        return if (dark) Color(0xFF1A2C40) to Color(0xFF8EB7E8) else Color(0xFFE7F1FB) to Color(0xFF1D4F91)
    }
    return RidersColors.primaryLight to RidersColors.primary
}
