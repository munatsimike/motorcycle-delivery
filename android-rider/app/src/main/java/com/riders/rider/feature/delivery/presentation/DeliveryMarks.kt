package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.riders.rider.R
import com.riders.rider.core.design.RidersChangingText
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.deliveryCardAddress
import com.riders.rider.feature.delivery.domain.deliveryPriceLabel
import com.riders.rider.feature.offers.presentation.RequestPaymentMark
import com.riders.rider.feature.delivery.domain.deliveryListBadge
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryWhenLabel
import com.riders.rider.feature.delivery.domain.serviceClassLabel
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
internal val cardLocationPinWidth = 26.dp
internal val cardLocationPinHeight = 26.dp

@Composable
fun ServiceClassLabel(serviceClass: String?, modifier: Modifier = Modifier) {
    val label = serviceClassLabel(serviceClass) ?: return
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            painter = painterResource(if (serviceClass == "EXPRESS") R.drawable.ic_service_urgent else R.drawable.ic_service_flexible),
            contentDescription = null,
            modifier = Modifier.size(14.dp),
            tint = RidersColors.textSecondary,
        )
        Text(
            label,
            style = TextStyle(
                fontSize = 13.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
                platformStyle = noFontPadding,
            ),
            color = RidersColors.textSecondary,
        )
    }
}

@Composable
fun LocationPin(
    dropoff: Boolean,
    modifier: Modifier = Modifier,
    width: Dp = locationPinWidth,
    height: Dp = locationPinHeight,
) {
    Icon(
        painter = painterResource(if (dropoff) R.drawable.ic_solid_dropoff_location else R.drawable.ic_solid_pickup_location),
        contentDescription = if (dropoff) "Drop-off" else "Pickup",
        modifier = modifier.size(width = width, height = height),
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

internal val DeliveryListCardElevation = 1.dp
internal val DeliveryListCardShadowColor = Color(0xFF17211D)

@Composable
fun DeliverySummaryCard(
    description: String,
    status: String,
    pickup: String,
    dropoff: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    details: List<String> = emptyList(),
    listBadge: Boolean = false,
    serviceClass: String? = null,
    filled: Boolean = true,
    containerColor: Color? = null,
    interactionEnabled: Boolean = true,
) {
    val shape = RoundedCornerShape(RidersRadius.lg)
    val dark = LocalAppDark.current
    val listed = if (listBadge) deliveryListBadge(status) else null
    val tone = if (listed != null) {
        StatusTone(Color(listed.background), Color(listed.foreground))
    } else {
        statusTone(status)
    }
    Column(
        modifier
            .shadow(
                elevation = if (filled) DeliveryListCardElevation else if (dark) 3.dp else 1.5.dp,
                shape = shape,
                clip = false,
                ambientColor = if (filled) DeliveryListCardShadowColor else Color.Black,
                spotColor = if (filled) DeliveryListCardShadowColor else Color.Black,
            )
            .clip(shape)
            .background(containerColor ?: if (filled) RidersColors.card else RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .then(if (interactionEnabled) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
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
                    ServiceClassLabel(serviceClass)
                }
                DeliveryRoute(
                    pickup,
                    dropoff,
                    modifier = Modifier.offset(x = -((cardLocationPinWidth - 15.dp) / 2)),
                    constantSpacing = true,
                    addressFontSize = 16.sp,
                    addressLineHeight = 21.sp,
                )
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
            DeliveryStop(
                pickupLine,
                dropoff = false,
                connect = false,
                pinColumn = cardLocationPinWidth,
                pinWidth = cardLocationPinWidth,
                pinHeight = cardLocationPinHeight,
                fontSize = addressFontSize,
                lineHeight = addressLineHeight,
            )
        }
        if (dropoffLine.isNotBlank()) {
            DeliveryStop(
                dropoffLine,
                dropoff = true,
                connect = false,
                pinColumn = cardLocationPinWidth,
                pinWidth = cardLocationPinWidth,
                pinHeight = cardLocationPinHeight,
                fontSize = addressFontSize,
                lineHeight = addressLineHeight,
            )
        }
    }
}

@Composable
fun DeliveryDetailsSummary(
    description: String,
    deliveryId: String,
    createdAt: String?,
    pickup: String,
    dropoff: String,
    distanceMeters: Int?,
    price: String?,
    currency: String = "USD",
    paymentMethod: String? = null,
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
    serviceClass: String? = null,
    senderName: String = "",
    customerSender: Boolean = false,
    dateFirst: Boolean = false,
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
        Column(
            verticalArrangement = Arrangement.spacedBy(if (parcelSheet) 12.dp else RidersSpacing.sm),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ContentIcon(description, size = 15.dp, muted = true)
                ContentLabel(description, compact = true)
                ServiceClassLabel(serviceClass)
            }
            if (framed || whenLabel.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                ) {
                    if (framed && !dateFirst) {
                        DetailFact("Delivery", shortDeliveryReference(deliveryId), Modifier.weight(1f))
                    }
                    if (whenLabel.isNotEmpty()) {
                        if (parcelSheet) {
                            Row(
                                Modifier.weight(1f),
                                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    painter = painterResource(R.drawable.ic_calendar),
                                    contentDescription = dateCaption,
                                    modifier = Modifier.size(18.dp),
                                    tint = RidersColors.textSecondary,
                                )
                                Text(
                                    whenLabel,
                                    style = RidersType.bodyStrong,
                                    color = RidersColors.text,
                                )
                            }
                        } else {
                            DetailFact(dateCaption, whenLabel, Modifier.weight(1f))
                        }
                    }
                    if (framed && dateFirst) {
                        DetailFact("Delivery", shortDeliveryReference(deliveryId), Modifier.weight(1f), alignEnd = true)
                    }
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
                    pinColumn = cardLocationPinWidth,
                    pinWidth = cardLocationPinWidth,
                    pinHeight = cardLocationPinHeight,
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
                    pinColumn = cardLocationPinWidth,
                    pinWidth = cardLocationPinWidth,
                    pinHeight = cardLocationPinHeight,
                    lineHeight = if (spacious) 23.sp else 20.sp,
                    fontSize = if (spacious) 16.sp else 14.sp,
                    above = dropoffContact,
                    below = dropoffDetail,
                )
            }
        }
        if (parcelSheet && !spacious) {
            Column(Modifier.fillMaxWidth()) {
                DistancePrice(distanceMeters, price, currency, paymentMethod)
            }
        } else {
            if (customerSender || !spacious) {
                Spacer(Modifier.height(RidersSpacing.md))
            }
            DistancePrice(distanceMeters, price, currency, paymentMethod)
        }
    }
}

@Composable
private fun DistancePrice(distanceMeters: Int?, price: String?, currency: String, paymentMethod: String?) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text("Distance", style = RidersType.caption, color = RidersColors.textSecondary)
            Text(
                distanceMeters?.let(::offerDistanceLabel) ?: "Unavailable",
                style = RidersType.heading,
                color = RidersColors.text,
            )
        }
        Column(
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            Text("Price", style = RidersType.caption, color = RidersColors.textSecondary)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
            ) {
                Text(
                    deliveryPriceLabel(price, currency) ?: "Unavailable",
                    style = RidersType.heading,
                    color = RidersColors.text,
                )
                RequestPaymentMark(paymentMethod)
            }
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
    val contactHeight = with(density) { 22.sp.toDp() }
    val textTop = ((cardLocationPinHeight - contactHeight) / 2).coerceAtLeast(0.dp)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        LocationPin(
            dropoff = dropoff,
            width = cardLocationPinWidth,
            height = cardLocationPinHeight,
        )
        Column(Modifier.weight(1f).padding(top = textTop)) {
            contact()
            detail()
        }
    }
}

@Composable
private fun DeliveredSender(name: String, address: String) {
    val shown = name.trim()
    val place = address.trim()
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
        if (shown.isNotEmpty()) {
            DetailFact("Sender", shown, Modifier.fillMaxWidth())
        } else {
            Text(
                "Sender",
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Start,
                style = RidersType.caption,
                color = RidersColors.textSecondary,
            )
        }
        if (place.isNotEmpty()) {
            Text(
                place,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                textAlign = TextAlign.Start,
                style = TextStyle(
                    fontSize = 18.sp,
                    lineHeight = 24.sp,
                    fontWeight = FontWeight.Normal,
                    platformStyle = noFontPadding,
                ),
                color = RidersColors.text,
            )
        }
    }
}

@Composable
private fun DetailFact(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    alignEnd: Boolean = false,
) {
    Column(
        modifier,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
    ) {
        Text(
            label,
            style = RidersType.caption,
            color = RidersColors.textSecondary,
            textAlign = if (alignEnd) TextAlign.End else TextAlign.Start,
        )
        Text(
            value,
            style = RidersType.bodyStrong,
            color = RidersColors.text,
            textAlign = if (alignEnd) TextAlign.End else TextAlign.Start,
        )
    }
}

@Composable
fun DeliveryStop(
    line: String,
    dropoff: Boolean,
    connect: Boolean,
    modifier: Modifier = Modifier,
    pinColumn: Dp = markSize,
    pinWidth: Dp = locationPinWidth,
    pinHeight: Dp = locationPinHeight,
    lineHeight: TextUnit = 18.sp,
    fontSize: TextUnit = 14.sp,
    above: @Composable () -> Unit = {},
    below: @Composable () -> Unit = {},
) {
    val density = LocalDensity.current
    var aboveHeight by remember { mutableStateOf(0.dp) }
    var belowHeight by remember { mutableStateOf(0.dp) }
    val hasName = aboveHeight > 0.dp
    val lineHeightDp = with(density) { lineHeight.toDp() }
    // The icon stays at the top. The first line of text is centered on it.
    val textTop = if (hasName) {
        ((pinHeight - aboveHeight) / 2).coerceAtLeast(0.dp)
    } else {
        ((pinHeight - lineHeightDp) / 2).coerceAtLeast(0.dp)
    }
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.width(pinColumn),
            contentAlignment = Alignment.TopCenter,
        ) {
            LocationPin(dropoff = dropoff, width = pinWidth, height = pinHeight)
        }
        Column(
            Modifier
                .weight(1f)
                .padding(top = textTop),
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
