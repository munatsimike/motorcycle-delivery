package com.riders.rider.feature.offers.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.riders.rider.core.design.*
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.delivery.presentation.ContentIcon
import com.riders.rider.feature.delivery.presentation.ContentLabel
import com.riders.rider.feature.delivery.presentation.ServiceClassLabel
import com.riders.rider.feature.bids.domain.requestStillNeedsOffer
import com.riders.rider.feature.offers.domain.requestSettled
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.offerDistanceLabel
import com.riders.rider.feature.offers.domain.requestAmountLabel

internal fun compactAvailableRequests(ui: OfferUi): List<OfferResponse> = ui.offers.filter {
    requestStillNeedsOffer(it.deliveryId, ui.ownBids, ui.sentAmounts) &&
        !requestSettled(it.deliveryId, it.searchExpiresAt, ui.settledIds) &&
        !requestCountdownExpired(it.searchExpiresAt, it.expiresAt, ui.nowMillis)
}.distinctBy { it.deliveryId }

@Composable
fun CompactRequestCard(offer: OfferResponse, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    RidersCard(modifier = modifier.fillMaxWidth(), onClick = onOpen, bottomPadding = RidersSpacing.md) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                ContentIcon(offer.parcel.description, size = 14.dp, muted = true)
                ContentLabel(offer.parcel.description, compact = true)
                ServiceClassLabel(offer.serviceClass)
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
