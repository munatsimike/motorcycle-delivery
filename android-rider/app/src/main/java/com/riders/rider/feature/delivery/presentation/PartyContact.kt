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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.delivery.domain.partyContactVisible
import com.riders.rider.feature.delivery.domain.senderDialUri
import com.riders.rider.feature.delivery.domain.senderInitials
import com.riders.rider.feature.delivery.domain.senderWhatsAppUri

@Composable
fun StopContactName(
    name: String,
    phone: String = "",
    actions: Boolean = false,
) {
    val shown = name.trim()
    val dialUri = if (actions) senderDialUri(phone) else null
    val whatsAppUri = if (actions) senderWhatsAppUri(phone) else null
    if (shown.isEmpty() && dialUri == null && whatsAppUri == null) {
        return
    }
    val context = LocalContext.current
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (shown.isNotEmpty()) {
            Text(
                shown,
                style = RidersType.captionStrong,
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
            }, size = 16.dp)
        }
        if (whatsAppUri != null) {
            ContactActionIcon(R.drawable.ic_whatsapp, "WhatsApp $shown", {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(whatsAppUri)))
                }
            }, size = 16.dp)
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
        address = address.trim(),
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
    onCall: (() -> Unit)?,
    onWhatsApp: (() -> Unit)?,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(48.dp)
                .height(56.dp)
                .clip(RoundedCornerShape(RidersRadius.md))
                .background(RidersColors.primaryLight),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                senderInitials(name),
                style = RidersType.body.copy(fontWeight = FontWeight.Bold),
                color = RidersColors.primaryDark,
            )
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
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
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
private fun ContactActionIcon(icon: Int, label: String, onClick: () -> Unit, size: Dp = 22.dp) {
    Icon(
        painter = painterResource(icon),
        contentDescription = label,
        tint = RidersColors.text,
        modifier = Modifier
            .size(size)
            .clickable(role = Role.Button, onClick = onClick),
    )
}

fun StopResponse.partyName(): String = contactName.trim()

fun StopResponse.partyPhone(): String = contactPhone.trim()
