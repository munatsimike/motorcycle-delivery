package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
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
import com.riders.rider.feature.delivery.domain.deliveryListBadge
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryWhenLabel
import com.riders.rider.feature.delivery.domain.shortDeliveryReference
import com.riders.rider.feature.offers.domain.offerDistanceLabel

private val markColor = RidersColors.text
private val markSize = 18.dp
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
fun ContentIcon(description: String, modifier: Modifier = Modifier, size: Dp = markSize, muted: Boolean = false) {
    Icon(
        painter = painterResource(contentIcon(description)),
        contentDescription = null,
        modifier = modifier.size(size),
        tint = if (muted) RidersColors.textSecondary else markColor,
    )
}

@Composable
fun ContentLabel(description: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    val parcel = deliveryContentLabel(description) == "Parcel"
    Text(
        deliveryContentLabel(description),
        modifier = modifier,
        style = TextStyle(
            fontSize = if (compact) 13.sp else if (parcel) 16.sp else 14.sp,
            lineHeight = if (parcel) 22.sp else 18.sp,
            fontWeight = if (compact) FontWeight.Medium else FontWeight.SemiBold,
            platformStyle = noFontPadding,
        ),
        color = if (compact) RidersColors.textSecondary else RidersColors.text,
    )
}

val pickupPinColor = Color(0xFF169B62)
val dropoffPinColor = Color(0xFF1A73E8)
private val locationPinWidth = 21.dp
private val locationPinHeight = 25.dp
/** Circle center in the pin artwork, as a fraction of its height. */
private const val locationPinHeadCenter = 23f / 58f

@Composable
fun LocationPin(
    dropoff: Boolean,
    modifier: Modifier = Modifier,
    size: Dp? = null,
) {
    Icon(
        painter = painterResource(if (dropoff) R.drawable.ic_solid_dropoff_location else R.drawable.ic_solid_pickup_location),
        contentDescription = if (dropoff) "Drop-off" else "Pickup",
        modifier = if (size != null) modifier.size(size) else modifier.size(width = locationPinWidth, height = locationPinHeight),
        tint = Color.Unspecified,
    )
}

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
    listBadge: Boolean = false,
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val listed = if (listBadge) deliveryListBadge(status) else null
    val tone = if (listed != null) {
        StatusTone(Color(listed.background), Color(listed.foreground))
    } else {
        statusTone(status)
    }
    Column(
        modifier
            .shadow(elevation = 2.dp, shape = shape, ambientColor = Color(0xFF17211D), spotColor = Color(0xFF17211D))
            .clip(shape)
            .background(RidersColors.card)
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
                    ContentIcon(description, size = 15.dp, muted = true)
                    ContentLabel(description, compact = true)
                }
                DeliveryRoute(pickup, dropoff, constantSpacing = true, addressFontSize = 16.sp, addressLineHeight = 21.sp)
                details.forEach { line ->
                    Text(line, style = RidersType.caption, color = RidersColors.textSecondary)
                }
            }
            RidersChangingText(
                value = listed?.label ?: deliveryStatusLabel(status),
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
fun DeliveryRoute(
    pickup: String,
    dropoff: String,
    modifier: Modifier = Modifier,
    constantSpacing: Boolean = false,
    addressFontSize: TextUnit = 14.sp,
    addressLineHeight: TextUnit = 18.sp,
) {
    val pickupLine = deliveryCardAddress(pickup)
    val dropoffLine = deliveryCardAddress(dropoff)
    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(if (constantSpacing) 8.dp else RidersSpacing.sm),
    ) {
        if (pickupLine.isNotBlank()) {
            DeliveryStop(pickupLine, dropoff = false, connect = false, fontSize = addressFontSize, lineHeight = addressLineHeight)
        }
        if (dropoffLine.isNotBlank()) {
            DeliveryStop(dropoffLine, dropoff = true, connect = false, fontSize = addressFontSize, lineHeight = addressLineHeight)
        }
    }
}

private val detailPinColumn = locationPinWidth

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
    flat: Boolean = false,
    spacious: Boolean = false,
    pickupContact: @Composable () -> Unit = {},
    dropoffContact: @Composable () -> Unit = {},
    pickupDetail: @Composable () -> Unit = {},
    dropoffDetail: @Composable () -> Unit = {},
    parcelSheet: Boolean = false,
    senderName: String = "",
    customerSender: Boolean = false,
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val whenLabel = deliveryWhenLabel(createdAt)
    val pickupLine = deliveryCardAddress(pickup)
    val dropoffLine = deliveryCardAddress(dropoff)
    val surface = if (framed) {
        modifier
            .then(
                if (flat) {
                    Modifier
                } else {
                    Modifier.shadow(elevation = 8.dp, shape = shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                },
            )
            .clip(shape)
            .background(RidersColors.background)
            .then(if (flat) Modifier else Modifier.border(1.dp, RidersColors.border, shape))
            .padding(if (spacious) RidersSpacing.md else RidersSpacing.lg)
    } else {
        modifier
    }
    Column(
        surface,
        verticalArrangement = Arrangement.spacedBy(if (parcelSheet) 20.dp else RidersSpacing.sm),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ContentIcon(description, size = 15.dp, muted = true)
            ContentLabel(description, compact = true)
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
        if (parcelSheet) {
            Column(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (pickupLine.isNotBlank()) {
                    ParcelDetailStop(dropoff = false, contact = pickupContact, detail = pickupDetail)
                }
                if (dropoffLine.isNotBlank()) {
                    ParcelDetailStop(dropoff = true, contact = dropoffContact, detail = dropoffDetail)
                }
            }
        } else if (customerSender) {
            if (senderName.isNotBlank() || pickupLine.isNotBlank()) {
                DeliveredSender(name = senderName, address = pickupLine)
            }
        } else {
            if (pickupLine.isNotBlank()) {
                DeliveryStop(
                    line = pickupLine,
                    dropoff = false,
                    connect = false,
                    pinColumn = detailPinColumn,
                    lineHeight = if (spacious) 23.sp else 20.sp,
                    fontSize = if (spacious) 16.sp else 14.sp,
                    above = pickupContact,
                    below = pickupDetail,
                )
            }
            if (dropoffLine.isNotBlank()) {
                DeliveryStop(
                    line = dropoffLine,
                    dropoff = true,
                    connect = false,
                    pinColumn = detailPinColumn,
                    lineHeight = if (spacious) 23.sp else 20.sp,
                    fontSize = if (spacious) 16.sp else 14.sp,
                    above = dropoffContact,
                    below = dropoffDetail,
                )
            }
        }
        if (parcelSheet && !spacious) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SheetDivider()
                DistancePrice(distanceMeters, price)
            }
        } else {
            if (customerSender || !spacious) {
                SheetDivider()
            }
            DistancePrice(distanceMeters, price)
        }
    }
}

@Composable
private fun SheetDivider() {
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
}

@Composable
private fun DistancePrice(distanceMeters: Int?, price: String?) {
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

@Composable
private fun ParcelDetailStop(
    dropoff: Boolean,
    contact: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val pinTop = with(density) { 22.sp.toDp() } / 2 - 28.dp * locationPinHeadCenter
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        LocationPin(
            dropoff = dropoff,
            modifier = Modifier.offset(y = pinTop),
            size = 28.dp,
        )
        Column(Modifier.weight(1f)) {
            contact()
            detail()
        }
    }
}

@Composable
private fun DeliveredSender(name: String, address: String) {
    val shown = name.trim()
    val place = address.trim()
    val density = LocalDensity.current
    val labelHeight = with(density) { 20.sp.toDp() }
    val nameHeight = with(density) { 22.sp.toDp() }
    val addressHeight = with(density) { 21.sp.toDp() }
    val pinAnchor = if (shown.isNotEmpty()) {
        labelHeight + 4.dp + nameHeight / 2
    } else {
        labelHeight + 4.dp + addressHeight / 2
    }
    val pinTop = (pinAnchor - locationPinHeight * locationPinHeadCenter).coerceAtLeast(0.dp)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .width(22.dp)
                .padding(top = pinTop),
            contentAlignment = Alignment.TopCenter,
        ) {
            LocationPin(dropoff = false)
        }
        Column(Modifier.weight(1f)) {
            Text(
                "Sender",
                style = RidersType.caption.copy(platformStyle = noFontPadding),
                color = RidersColors.textSecondary,
            )
            if (shown.isNotEmpty()) {
                Text(
                    shown,
                    modifier = Modifier.padding(top = 4.dp),
                    style = RidersType.bodyStrong.copy(
                        fontWeight = FontWeight.Bold,
                        platformStyle = noFontPadding,
                    ),
                    color = RidersColors.text,
                )
            }
            if (place.isNotEmpty()) {
                Text(
                    place,
                    modifier = Modifier.padding(top = 4.dp),
                    style = TextStyle(
                        fontSize = 16.sp,
                        lineHeight = 21.sp,
                        fontWeight = FontWeight.Normal,
                        platformStyle = noFontPadding,
                    ),
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
    line: String,
    dropoff: Boolean,
    connect: Boolean,
    modifier: Modifier = Modifier,
    pinColumn: Dp = markSize,
    lineHeight: TextUnit = 18.sp,
    fontSize: TextUnit = 14.sp,
    above: @Composable () -> Unit = {},
    below: @Composable () -> Unit = {},
) {
    val density = LocalDensity.current
    var aboveHeight by remember { mutableStateOf(0.dp) }
    var belowHeight by remember { mutableStateOf(0.dp) }
    val hasName = aboveHeight > 0.dp
    // A name above the address owns the pin. Otherwise the pin head sits on the address line.
    val pinTop = if (hasName) {
        (aboveHeight / 2 - locationPinHeight * locationPinHeadCenter).coerceAtLeast(0.dp)
    } else {
        with(density) {
            (lineHeight.toDp() / 2 - locationPinHeight * locationPinHeadCenter).coerceAtLeast(0.dp)
        }
    }
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .width(pinColumn)
                .padding(top = pinTop),
            contentAlignment = Alignment.TopCenter,
        ) {
            LocationPin(dropoff = dropoff)
        }
        Column(
            Modifier
                .weight(1f)
                .padding(bottom = if (connect) RidersSpacing.sm else 0.dp),
        ) {
            Box(
                Modifier.onSizeChanged { size ->
                    aboveHeight = with(density) { size.height.toDp() }
                },
            ) {
                above()
            }
            Text(
                line,
                style = placeText.copy(
                    fontSize = fontSize,
                    lineHeight = if (hasName) fontSize else lineHeight,
                ),
                color = RidersColors.text,
            )
            Box(
                Modifier
                    .padding(top = if (belowHeight > 0.dp) 2.dp else 0.dp)
                    .onSizeChanged { size ->
                        belowHeight = with(density) { size.height.toDp() }
                    },
            ) {
                below()
            }
        }
    }
}
