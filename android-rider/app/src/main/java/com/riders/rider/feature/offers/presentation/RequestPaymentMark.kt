package com.riders.rider.feature.offers.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.offers.domain.requestPaymentBadge

@Composable
fun RequestPaymentMark(method: String?, modifier: Modifier = Modifier) {
    val label = requestPaymentBadge(method) ?: return
    Text(
        label,
        modifier = modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(RidersColors.primaryLight)
            .padding(horizontal = RidersSpacing.sm, vertical = 2.dp),
        style = RidersType.captionStrong,
        color = RidersColors.primary,
        maxLines = 1,
    )
}
