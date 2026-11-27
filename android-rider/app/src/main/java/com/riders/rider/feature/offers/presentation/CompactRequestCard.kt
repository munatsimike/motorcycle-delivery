package com.riders.rider.feature.offers.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.riders.rider.core.design.*
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.ServiceClassLabel
import com.riders.rider.feature.offers.domain.actionableRequestCards
import com.riders.rider.feature.offers.domain.compactRequestTimerLabel
import com.riders.rider.feature.offers.domain.riderExpiryDisplay
import com.riders.rider.feature.offers.domain.offerDistanceLabel
import com.riders.rider.feature.offers.domain.requestAmountLabel

internal fun compactAvailableRequests(ui: OfferUi): List<OfferResponse> = actionableRequestCards(
    ui.offers, ui.ownBids, ui.sentAmounts, ui.settledIds, ui.nowMillis,
)

@Composable
fun CompactRequestCard(offer: OfferResponse, nowMillis: Long, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    RidersCard(modifier = modifier.fillMaxWidth(), onClick = onOpen, bottomPadding = RidersSpacing.md) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm), verticalAlignment = Alignment.Top) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                ContentIcon(offer.parcel.description, size = 14.dp, muted = true)
                ContentLabel(offer.parcel.description, compact = true)
                ServiceClassLabel(offer.serviceClass)
            }
            val timer = compactRequestTimerLabel(offer.searchExpiresAt, offer.expiresAt, nowMillis)
            if (timer != null) {
                val time = timer.substringAfterLast(' ').split(':')
                val seconds = if (time.size == 2) {
                    (time[0].toLongOrNull() ?: 0L) * 60L + (time[1].toLongOrNull() ?: 0L)
                } else 0L
                val urgent = seconds <= 60L
                Text(
                    text = timer,
                    modifier = Modifier
                        .background(
                            if (urgent) RidersColors.dangerSurface else RidersColors.primaryLight,
                            RoundedCornerShape(RidersRadius.pill),
                        )
                        .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.xs)
                        .clearAndSetSemantics {
                            contentDescription = riderExpiryDisplay(offer.searchExpiresAt, offer.expiresAt, nowMillis)
                        },
                    style = RidersType.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = if (urgent) RidersColors.error else RidersColors.primary,
                    maxLines = 1,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Column {
                Text("Distance", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(offerDistanceLabel(offer.distanceMeters), style = RidersType.heading, color = RidersColors.text)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("Price", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(requestAmountLabel(offer.currency, offer.offeredPrice), style = RidersType.heading, color = RidersColors.text)
            }
        }
    }
}
