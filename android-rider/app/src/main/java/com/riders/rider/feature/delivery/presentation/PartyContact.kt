package com.riders.rider.feature.delivery.presentation

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.delivery.domain.partyContactVisible
import com.riders.rider.feature.delivery.domain.senderDialUri
import com.riders.rider.feature.delivery.domain.recipientAvatarSlot
import com.riders.rider.feature.delivery.domain.senderInitials
import com.riders.rider.feature.delivery.domain.senderWhatsAppUri

@Composable
fun StopContactName(
    name: String,
    phone: String = "",
    actions: Boolean = false,
    sheet: Boolean = false,
    address: String = "",
) {
    val shown = name.trim()
    val place = address.trim()
    val dialUri = if (actions) senderDialUri(phone) else null
    val whatsAppUri = if (actions) senderWhatsAppUri(phone) else null
    if (shown.isEmpty() && dialUri == null && whatsAppUri == null && place.isEmpty()) {
        return
    }
    val context = LocalContext.current
    if (sheet) {
        val showName = shown.isNotEmpty()
        val showPlace = place.isNotEmpty()
        val showActions = dialUri != null || whatsAppUri != null
        val nameStyle = RidersType.body.copy(
            fontSize = 17.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
            platformStyle = PlatformTextStyle(includeFontPadding = false),
        )
        val addressStyle = RidersType.body.copy(
            fontSize = 16.sp,
            lineHeight = 22.sp,
            platformStyle = PlatformTextStyle(includeFontPadding = false),
        )
        Layout(
            content = {
                if (showName) {
                    Text(shown, style = nameStyle, color = RidersColors.text)
                }
                if (showPlace) {
                    Text(place, style = addressStyle, color = RidersColors.text)
                }
                if (showActions) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (dialUri != null) {
                            ContactActionIcon(R.drawable.ic_phone_outline, "Call $shown", {
                                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(dialUri)))
                            }, size = 25.dp, layoutSize = 48.dp)
                        }
                        if (whatsAppUri != null) {
                            ContactActionIcon(R.drawable.ic_whatsapp, "WhatsApp $shown", {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(whatsAppUri)))
                                }
                            }, size = 25.dp, layoutSize = 48.dp)
                        }
                    }
                }
            },
        ) { measurables, constraints ->
            val loose = constraints.copy(minWidth = 0, minHeight = 0)
            var index = 0
            val nameMeasurable = if (showName) measurables[index++] else null
            val placeMeasurable = if (showPlace) measurables[index++] else null
            val actionMeasurable = if (showActions) measurables[index] else null
            val actions = actionMeasurable?.measure(loose)
            val textWidth = (constraints.maxWidth - (actions?.width ?: 0)).coerceAtLeast(0)
            val textConstraints = loose.copy(maxWidth = textWidth)
            val name = nameMeasurable?.measure(textConstraints)
            val address = placeMeasurable?.measure(textConstraints)
            val gap = if (name != null && address != null) 4.dp.roundToPx() else 0
            val nameHeight = name?.height ?: 0
            val width = constraints.maxWidth
            val height = nameHeight + gap + (address?.height ?: 0)
            layout(width, height) {
                name?.place(0, 0)
                address?.place(0, nameHeight + gap)
                val anchorHeight = nameHeight.takeIf { it > 0 } ?: address?.height ?: 0
                actions?.let { placeable ->
                    placeable.place(width - placeable.width, (anchorHeight - placeable.height) / 2)
                }
            }
        }
        return
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (shown.isNotEmpty()) {
            Text(
                shown,
                style = RidersType.captionStrong.copy(
                    lineHeight = 14.sp,
                    platformStyle = PlatformTextStyle(includeFontPadding = false),
                ),
                color = RidersColors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        } else {
            Box(Modifier.weight(1f))
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
        if (dialUri != null) {
            ContactActionIcon(R.drawable.ic_phone_outline, "Call $shown", {
                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(dialUri)))
            }, size = 16.dp, layoutSize = 16.dp)
        }
        if (whatsAppUri != null) {
            ContactActionIcon(R.drawable.ic_whatsapp, "WhatsApp $shown", {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(whatsAppUri)))
                }
            }, size = 16.dp, layoutSize = 16.dp)
        }
        }
    }
}

@Composable
fun PartyContact(
    role: String,
    name: String,
    phone: String,
    address: String,
    compact: Boolean = false,
    tinted: Boolean = false,
    plain: Boolean = false,
) {
    if (!partyContactVisible(name, phone, address)) {
        return
    }
    val context = LocalContext.current
    val shown = name.trim().ifEmpty { role }
    val dialUri = senderDialUri(phone)
    val whatsAppUri = senderWhatsAppUri(phone)
    PartyContactRow(
        role = role,
        name = shown,
        address = if (compact || plain) "" else address.trim(),
        compact = compact,
        tinted = tinted,
        plain = plain,
        onCall = dialUri?.let { uri ->
            {
                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(uri)))
            }
        },
        onWhatsApp = whatsAppUri?.let { uri ->
            {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
                }
            }
        },
    )
}

@Composable
private fun PartyContactRow(
    role: String,
    name: String,
    address: String,
    compact: Boolean,
    tinted: Boolean,
    plain: Boolean,
    onCall: (() -> Unit)?,
    onWhatsApp: (() -> Unit)?,
) {
    val tone = if (tinted) recipientAvatarTones[recipientAvatarSlot(name, recipientAvatarTones.size)] else null
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!plain) {
            Box(
                if (compact) {
                    Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(RidersRadius.md))
                        .background(tone?.background ?: RidersColors.primaryLight)
                } else {
                    Modifier
                        .width(48.dp)
                        .height(56.dp)
                        .clip(RoundedCornerShape(RidersRadius.md))
                        .background(tone?.background ?: RidersColors.primaryLight)
                },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    senderInitials(name),
                    style = RidersType.body.copy(fontWeight = if (tinted) FontWeight.SemiBold else FontWeight.Bold),
                    color = tone?.foreground ?: RidersColors.primaryDark,
                )
            }
        }
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
        ) {
            Text(role, style = RidersType.caption, color = RidersColors.textSecondary)
            Text(
                name,
                style = RidersType.body.copy(fontWeight = FontWeight.Bold),
                color = RidersColors.text,
                maxLines = if (plain) Int.MAX_VALUE else 1,
                overflow = if (plain) TextOverflow.Clip else TextOverflow.Ellipsis,
            )
            if (address.isNotEmpty()) {
                Text(
                    address,
                    style = RidersType.caption,
                    color = RidersColors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (onCall != null || onWhatsApp != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onCall != null) {
                    ContactActionIcon(R.drawable.ic_phone_outline, "Call $name", onCall)
                }
                if (onWhatsApp != null) {
                    ContactActionIcon(R.drawable.ic_whatsapp, "WhatsApp $name", onWhatsApp)
                }
            }
        }
    }
}

@Composable
private fun ContactActionIcon(icon: Int, label: String, onClick: () -> Unit, size: Dp = 24.dp, layoutSize: Dp = 40.dp) {
    Box(
        Modifier
            .size(layoutSize)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = label,
            tint = androidx.compose.ui.graphics.Color.Black,
            modifier = Modifier.size(size),
        )
    }
}

private data class AvatarTone(val background: Color, val foreground: Color)

private val recipientAvatarTones = listOf(
    AvatarTone(Color(0xFFFCE8E6), Color(0xFFA50E0E)),
    AvatarTone(Color(0xFFFEF7E0), Color(0xFFB06000)),
    AvatarTone(Color(0xFFE6F4EA), Color(0xFF0D652D)),
    AvatarTone(Color(0xFFE8F0FE), Color(0xFF174EA6)),
    AvatarTone(Color(0xFFF3E8FD), Color(0xFF681DA8)),
    AvatarTone(Color(0xFFFDE7F3), Color(0xFF9C166B)),
    AvatarTone(Color(0xFFE0F7FA), Color(0xFF006064)),
    AvatarTone(Color(0xFFFFF3E0), Color(0xFFE65100)),
)

fun StopResponse.partyName(): String = contactName.trim()

fun StopResponse.partyPhone(): String = contactPhone.trim()
