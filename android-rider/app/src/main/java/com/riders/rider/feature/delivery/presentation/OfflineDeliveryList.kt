package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.ReportNetworkNotice
import com.riders.rider.feature.delivery.data.OfflineSnapshot
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.sortDeliveries

@Composable
fun OfflineDeliveryList(snapshot: OfflineSnapshot?, contentKind: String?, sort: DeliveryListSort, completed: Boolean, modifier: Modifier = Modifier, reportOffline: Boolean = true) {
    ReportNetworkNotice(active = reportOffline)
    val visible = sortDeliveries(
        snapshot?.parcels.orEmpty().filter { deliveryContentMatches(it.parcelDescription, contentKind) },
        sort, { if (completed) it.completedAt ?: it.createdAt else it.createdAt },
        { it.distanceMeters }, { it.agreedPrice }, { it.deliveryId },
    )
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(start = RidersSpacing.lg, end = RidersSpacing.lg, bottom = RidersSpacing.lg), verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg)) {
        items(visible, key = { "assignment:${it.assignmentId}" }, contentType = { "delivery" }) { parcel ->
            DeliverySummaryCard(
                description = parcel.parcelDescription, status = parcel.status,
                pickup = parcel.pickupAddress, dropoff = parcel.dropoffAddress,
                onClick = {}, modifier = Modifier.fillMaxWidth(), listBadge = true,
                serviceClass = parcel.serviceClass, filled = completed,
                containerColor = if (completed && !LocalAppDark.current) Color.White else null,
                interactionEnabled = false,
            )
        }
    }
}
