package com.riders.rider.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

enum class RidersButtonTone {
    Primary,
    Danger,
}

enum class RidersAvailability {
    Offline,
    Available,
    Busy,
}

fun ridersAvailability(status: String?): RidersAvailability = when (status) {
    "AVAILABLE" -> RidersAvailability.Available
    "BUSY" -> RidersAvailability.Busy
    else -> RidersAvailability.Offline
}

@Composable
fun RidersWordmark(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics { contentDescription = "Riders Delivery" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("R", style = RidersType.brandLetter, color = RidersColors.primary)
        Column {
            Text("iders", style = RidersType.brandName, color = RidersColors.text)
            Text("DELIVERY", style = RidersType.brandCaption, color = RidersColors.textSecondary)
        }
    }
}

@Composable
fun RidersPrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    loadingLabel: String? = null,
) {
    val inactive = !enabled || loading
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 56.dp)
            .alpha(if (inactive) 0.6f else 1f)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.primary)
            .clickable(enabled = !inactive, role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    color = RidersColors.textInverse,
                    strokeWidth = 2.dp,
                )
                if (loadingLabel != null) {
                    Text(loadingLabel, style = RidersType.button, color = RidersColors.textInverse)
                }
            }
        } else {
            Text(label, style = RidersType.button, color = RidersColors.textInverse, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun RidersSecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    tone: RidersButtonTone = RidersButtonTone.Primary,
    soft: Boolean = true,
) {
    val inactive = !enabled || loading
    val accent = if (tone == RidersButtonTone.Danger) RidersColors.error else RidersColors.primary
    val fill = when {
        tone == RidersButtonTone.Danger -> RidersColors.dangerSurface
        soft -> RidersColors.primaryLight
        else -> RidersColors.background
    }
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 56.dp)
            .alpha(if (inactive) 0.6f else 1f)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(fill)
            .border(1.dp, accent, RoundedCornerShape(RidersRadius.lg))
            .clickable(enabled = !inactive, role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), color = accent, strokeWidth = 2.dp)
        } else {
            Text(label, style = RidersType.button, color = accent, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun RidersCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    prominent: Boolean = false,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(if (prominent) RidersRadius.xl else RidersRadius.lg)
    val clickable = if (onClick == null) {
        Modifier
    } else {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    }
    Column(
        modifier = modifier
            .shadow(elevation = 4.dp, shape = shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(shape)
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .then(clickable)
            .padding(RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        content()
    }
}

@Composable
fun RidersStatusIndicator(
    availability: RidersAvailability,
    modifier: Modifier = Modifier,
) {
    val (label, color, fill) = when (availability) {
        RidersAvailability.Available -> Triple("Available", RidersColors.primaryDark, RidersColors.primaryLight)
        RidersAvailability.Busy -> Triple("On a delivery", RidersColors.primaryDark, RidersColors.surface)
        RidersAvailability.Offline -> Triple("Offline", RidersColors.textSecondary, RidersColors.surface)
    }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(fill)
            .border(1.dp, RidersColors.border, RoundedCornerShape(RidersRadius.pill))
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs)
            .semantics { contentDescription = "Availability $label" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(if (availability == RidersAvailability.Offline) RidersColors.textSecondary else RidersColors.primary),
        )
        Spacer(Modifier.width(RidersSpacing.sm))
        Text(label, style = RidersType.captionStrong, color = color)
    }
}

@Composable
fun RidersLoadingState(
    message: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = RidersSpacing.xl)
            .semantics { contentDescription = message },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(36.dp), color = RidersColors.primary, strokeWidth = 3.dp)
        Text(message, style = RidersType.caption, color = RidersColors.textSecondary, textAlign = TextAlign.Center)
    }
}

@Composable
fun RidersEmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.background)
            .padding(RidersSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Text(title, style = RidersType.heading, color = RidersColors.text, textAlign = TextAlign.Center)
        Text(body, style = RidersType.body, color = RidersColors.textSecondary, textAlign = TextAlign.Center)
    }
}

@Composable
fun RidersErrorState(
    message: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    retryLabel: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        if (title != null) {
            Text(title, style = RidersType.captionStrong, color = RidersColors.textSecondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        Text(message, style = RidersType.caption, color = RidersColors.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        if (retryLabel != null && onRetry != null) {
            RidersSecondaryButton(label = retryLabel, onClick = onRetry, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun RidersTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    error: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(RidersRadius.md)
    val borderColor = when {
        error != null -> RidersColors.error
        focused -> RidersColors.primary
        else -> RidersColors.border
    }
    val borderWidth = if (focused || error != null) 2.dp else 1.dp
    Column(modifier) {
        Text(label, style = RidersType.captionStrong, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.sm))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 58.dp)
                .shadow(
                    elevation = if (focused) 4.dp else 0.dp,
                    shape = shape,
                    ambientColor = RidersColors.focusRing,
                    spotColor = RidersColors.focusRing,
                )
                .clip(shape)
                .background(if (enabled) RidersColors.background else RidersColors.surface)
                .border(borderWidth, borderColor, shape)
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
            enabled = enabled,
            textStyle = RidersType.button.copy(color = if (enabled) RidersColors.text else RidersColors.textSecondary),
            keyboardOptions = keyboardOptions,
            visualTransformation = visualTransformation,
            singleLine = true,
            interactionSource = interaction,
            cursorBrush = SolidColor(RidersColors.primary),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = RidersType.button, color = RidersColors.textSecondary)
                    }
                    inner()
                }
            },
        )
        if (error != null) {
            Spacer(Modifier.height(RidersSpacing.sm))
            Text(error, style = RidersType.caption, color = RidersColors.error)
        } else {
            Spacer(Modifier.height(RidersSpacing.md))
        }
    }
}
