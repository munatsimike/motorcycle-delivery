package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.riders.rider.R
import com.riders.rider.core.design.RidersChangingText
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.deliveryCardAddress
import com.riders.rider.feature.delivery.domain.deliveryPriceLabel
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryWhenLabel
import com.riders.rider.feature.delivery.domain.shortDeliveryReference
import com.riders.rider.feature.offers.domain.offerDistanceLabel

private val markColor = Color.Black
private val markSize = 18.dp
private val badgeIconSize = 16.dp
private val noFontPadding = PlatformTextStyle(includeFontPadding = false)

fun deliveryContentLabel(description: String): String {
    return when (description.trim().lowercase()) {
        "food" -> "Food"
        "document", "documents", "doc" -> "Document"
        else -> "Parcel"
    }
}

fun deliveryContentMatches(description: String, kind: String?): Boolean {
    if (kind.isNullOrBlank()) {
        return true
    }
    return deliveryContentLabel(description) == kind
}

fun filteredContentTitle(kind: String?, fallback: String): String = when (kind) {
    "Parcel" -> "No parcels"
    "Document" -> "No documents"
    "Food" -> "No food deliveries"
    else -> fallback
}

private fun contentIcon(description: String): Int {
    return when (deliveryContentLabel(description)) {
        "Food" -> R.drawable.ic_silverware_fork_knife
        "Document" -> R.drawable.ic_file_document_outline
        else -> R.drawable.ic_nav_deliveries
    }
}

@Composable
fun ContentIcon(description: String, modifier: Modifier = Modifier, size: Dp = markSize) {
    Icon(
        painter = painterResource(contentIcon(description)),
        contentDescription = null,
        modifier = modifier.size(size),
        tint = markColor,
    )
}

@Composable
fun ContentLabel(description: String, modifier: Modifier = Modifier) {
    val parcel = deliveryContentLabel(description) == "Parcel"
    Text(
        deliveryContentLabel(description),
        modifier = modifier,
        style = TextStyle(
            fontSize = if (parcel) 16.sp else 14.sp,
            lineHeight = if (parcel) 22.sp else 18.sp,
            fontWeight = FontWeight.SemiBold,
            platformStyle = noFontPadding,
        ),
        color = RidersColors.text,
    )
}

@Composable
fun LocationPin(dropoff: Boolean, modifier: Modifier = Modifier) {
    Icon(
        painter = painterResource(R.drawable.ic_map_marker_outline),
        contentDescription = null,
        modifier = modifier.size(markSize),
        tint = if (dropoff) RidersColors.text else markColor,
    )
}

@Composable
fun StopLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = RidersType.caption,
        color = RidersColors.textSecondary,
    )
}

@Composable
fun ServiceClassBadge(serviceClass: String?, modifier: Modifier = Modifier) {
    val urgent = serviceClass == "EXPRESS"
    Row(
        modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(Color.White)
            .padding(horizontal = RidersSpacing.sm),
        // The flash glyph leaves 3dp more empty space before the label than the message glyph.
        horizontalArrangement = Arrangement.spacedBy(if (urgent) 1.dp else RidersSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(if (urgent) R.drawable.ic_flash_outline else R.drawable.ic_message_text_outline),
            contentDescription = null,
            modifier = Modifier.size(badgeIconSize),
            tint = markColor,
        )
        Text(
            if (urgent) "Urgent" else "Flexible",
            style = TextStyle(
                fontSize = 14.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
                platformStyle = noFontPadding,
            ),
            color = RidersColors.textSecondary,
        )
    }
}

private val cardSurface = Color(0xFFF8FAF9)
private val routeDot = Color(0xFFB7C2BC)
private val placeText = TextStyle(
    fontSize = 14.sp,
    lineHeight = 18.sp,
    fontWeight = FontWeight.Normal,
    platformStyle = noFontPadding,
)

private data class StatusTone(val background: Color, val content: Color)

private fun statusTone(status: String): StatusTone = when (status) {
    "CREATED", "SEARCHING" -> StatusTone(Color(0xFFEEF2F6), Color(0xFF475569))
    "NO_RIDER_FOUND" -> StatusTone(Color(0xFFFFF4E5), Color(0xFFC56A12))
    "CANCELLED", "FAILED" -> StatusTone(Color(0xFFFDECEC), RidersColors.error)
    else -> StatusTone(RidersColors.primaryLight, RidersColors.primaryDark)
}

@Composable
fun DeliverySummaryCard(
    description: String,
    serviceClass: String?,
    status: String,
    pickup: String,
    dropoff: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    details: List<String> = emptyList(),
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val tone = statusTone(status)
    Column(
        modifier
            .shadow(elevation = 2.dp, shape = shape, ambientColor = Color(0xFF17211D), spotColor = Color(0xFF17211D))
            .clip(shape)
            .background(cardSurface)
            .border(1.dp, RidersColors.border, shape)
            .clickable(role = Role.Button, onClick = onClick),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
        ) {
            Column(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(end = 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ContentIcon(description)
                    ContentLabel(description)
                    if (serviceClass == "EXPRESS" || serviceClass == "FLEXIBLE") {
                        ServiceClassBadge(serviceClass)
                    }
                }
                DeliveryRoute(pickup, dropoff)
                details.forEach { line ->
                    Text(line, style = RidersType.caption, color = RidersColors.textSecondary)
                }
            }
            RidersChangingText(
                value = deliveryStatusLabel(status),
                style = RidersType.small.copy(fontWeight = FontWeight.Bold),
                color = tone.content,
                maxLines = 1,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .clip(RoundedCornerShape(RidersRadius.pill))
                    .background(tone.background)
                    .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.xs),
            )
        }
        Box(
            Modifier
                .padding(horizontal = RidersSpacing.lg)
                .fillMaxWidth()
                .height(0.5.dp)
                .background(RidersColors.border),
        )
    }
}

@Composable
fun DeliveryRoute(pickup: String, dropoff: String, modifier: Modifier = Modifier) {
    val pickupLine = deliveryCardAddress(pickup)
    val dropoffLine = deliveryCardAddress(dropoff)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
        if (pickupLine.isNotBlank()) {
            DeliveryStop("Pickup", pickupLine, dropoff = false, connect = dropoffLine.isNotBlank())
        }
        if (dropoffLine.isNotBlank()) {
            DeliveryStop("Drop-off", dropoffLine, dropoff = true, connect = false)
        }
    }
}

private val detailPinColumn = 32.dp

@Composable
fun DeliveryDetailsSummary(
    description: String,
    serviceClass: String?,
    deliveryId: String,
    createdAt: String?,
    pickup: String,
    dropoff: String,
    distanceMeters: Int?,
    price: String?,
    modifier: Modifier = Modifier,
    dateCaption: String = "Date",
    framed: Boolean = true,
    pickupDetail: @Composable () -> Unit = {},
    dropoffDetail: @Composable () -> Unit = {},
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val whenLabel = deliveryWhenLabel(createdAt)
    val pickupLine = deliveryCardAddress(pickup)
    val dropoffLine = deliveryCardAddress(dropoff)
    val surface = if (framed) {
        modifier
            .shadow(elevation = 8.dp, shape = shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(shape)
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .padding(RidersSpacing.lg)
    } else {
        modifier
    }
    Column(
        surface,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ContentIcon(description)
            ContentLabel(description)
            if (serviceClass == "EXPRESS" || serviceClass == "FLEXIBLE") {
                ServiceClassBadge(serviceClass)
            }
        }
        if (framed || whenLabel.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                if (framed) {
                    DetailFact("Delivery", shortDeliveryReference(deliveryId), Modifier.weight(1f))
                }
                if (whenLabel.isNotEmpty()) {
                    DetailFact(dateCaption, whenLabel, Modifier.weight(1f))
                }
            }
        }
        if (pickupLine.isNotBlank()) {
            DeliveryStop(
                label = "Pickup",
                line = pickupLine,
                dropoff = false,
                connect = dropoffLine.isNotBlank(),
                pinColumn = detailPinColumn,
                lineHeight = 20.sp,
                below = pickupDetail,
            )
        }
        if (dropoffLine.isNotBlank()) {
            DeliveryStop(
                label = "Drop-off",
                line = dropoffLine,
                dropoff = true,
                connect = false,
                pinColumn = detailPinColumn,
                lineHeight = 20.sp,
                below = dropoffDetail,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.Transparent, RidersColors.border, Color.Transparent),
                    ),
                ),
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                Text("Distance", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(
                    distanceMeters?.let(::offerDistanceLabel) ?: "Unavailable",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            }
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
            ) {
                Text("Price", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(
                    deliveryPriceLabel(price) ?: "Unavailable",
                    style = RidersType.heading,
                    color = RidersColors.text,
                )
            }
        }
    }
}

@Composable
private fun DetailFact(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary)
        Text(value, style = RidersType.bodyStrong, color = RidersColors.text)
    }
}

@Composable
fun DeliveryStop(
    label: String,
    line: String,
    dropoff: Boolean,
    connect: Boolean,
    modifier: Modifier = Modifier,
    pinColumn: Dp = markSize,
    lineHeight: TextUnit = 18.sp,
    below: @Composable () -> Unit = {},
) {
    Row(
        modifier.height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            Modifier.width(pinColumn).fillMaxHeight(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LocationPin(dropoff = dropoff)
            if (connect) {
                Column(
                    Modifier.weight(1f).padding(vertical = RidersSpacing.xs),
                    verticalArrangement = Arrangement.SpaceEvenly,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    repeat(3) {
                        Box(
                            Modifier
                                .size(3.dp)
                                .clip(CircleShape)
                                .background(routeDot),
                        )
                    }
                }
            }
        }
        Column(
            Modifier.weight(1f).padding(bottom = if (connect) RidersSpacing.sm else 0.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            StopLabel(label)
            Text(line, style = placeText.copy(lineHeight = lineHeight), color = RidersColors.text)
            below()
        }
    }
}
