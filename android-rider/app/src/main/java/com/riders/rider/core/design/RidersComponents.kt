package com.riders.rider.core.design

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.riders.rider.R

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
fun RidersBrandLogo(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics { contentDescription = "Riders Delivery" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "R",
            color = RidersColors.primary,
            fontSize = 66.sp,
            fontWeight = FontWeight.Black,
            lineHeight = 66.sp,
        )
        Column {
            Text(
                "iders",
                color = RidersColors.text,
                fontSize = 36.sp,
                fontWeight = FontWeight.ExtraBold,
                lineHeight = 40.sp,
            )
            Text(
                "DELIVERY",
                color = RidersColors.textSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Normal,
                letterSpacing = 4.sp,
                lineHeight = 16.sp,
            )
        }
    }
}

@Composable
fun RidersBrandMark(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Image(
            painter = painterResource(R.drawable.rider_image),
            contentDescription = null,
            modifier = Modifier.size(width = 129.dp, height = 97.dp),
            contentScale = ContentScale.Fit,
        )
        RidersBrandLogo()
    }
}

@Composable
fun ZimbabweFlag(modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(R.drawable.zimbabwe_flag),
        contentDescription = "Zimbabwe",
        modifier = modifier
            .width(28.dp)
            .height(22.dp)
            .clip(RoundedCornerShape(2.dp)),
        contentScale = ContentScale.Crop,
    )
}

@Composable
fun PhoneWithFlag(
    phone: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        if (phone.trimStart().startsWith("+263")) {
            ZimbabweFlag()
        }
        Text(phone, style = style, color = color)
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
    icon: Int? = null,
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
            ButtonLabel(label, RidersColors.textInverse, icon)
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
    @Suppress("UNUSED_PARAMETER") soft: Boolean = true,
    bordered: Boolean = true,
    icon: Int? = null,
) {
    val inactive = !enabled || loading
    val accent = if (tone == RidersButtonTone.Danger) RidersColors.error else RidersColors.primary
    val fill = RidersColors.background
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 56.dp)
            .alpha(if (inactive) 0.6f else 1f)
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(fill)
            .then(
                if (bordered) {
                    Modifier.border(1.dp, accent, RoundedCornerShape(RidersRadius.lg))
                } else {
                    Modifier
                },
            )
            .clickable(enabled = !inactive, role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), color = accent, strokeWidth = 2.dp)
        } else {
            ButtonLabel(label, accent, icon)
        }
    }
}

@Composable
fun RidersViewDetailsButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .clip(RoundedCornerShape(RidersRadius.md))
            .border(1.dp, RidersColors.border, RoundedCornerShape(RidersRadius.md))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_info),
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = RidersColors.textSecondary,
        )
        Text(
            "View details",
            style = RidersType.body,
            color = RidersColors.textSecondary,
            modifier = Modifier.padding(horizontal = RidersSpacing.xs),
        )
        Icon(
            painter = painterResource(R.drawable.ic_chevron_right),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = RidersColors.textSecondary,
        )
    }
}

@Composable
private fun ButtonLabel(label: String, color: Color, icon: Int?) {
    if (icon == null) {
        Text(label, style = RidersType.button, color = color, textAlign = TextAlign.Center)
        return
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = color,
        )
        Text(label, style = RidersType.button, color = color, textAlign = TextAlign.Center)
    }
}

@Composable
fun RidersCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    prominent: Boolean = false,
    emphasizePress: Boolean = false,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(if (prominent) RidersRadius.xl else RidersRadius.lg)
    val motion = rememberRidersMotion()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (emphasizePress) offerPressScale(pressed, motion.enabled) else 1f,
        animationSpec = tween(motion.duration(RidersMotion.PRESS_MS)),
        label = "card-press",
    )
    val clickable = if (onClick == null) {
        Modifier
    } else {
        Modifier.clickable(
            interactionSource = interaction,
            indication = LocalIndication.current,
            role = Role.Button,
            onClick = onClick,
        )
    }
    Column(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
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
        RidersAvailability.Available, RidersAvailability.Busy -> Triple("Online", RidersColors.primaryDark, RidersColors.primaryLight)
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
fun RidersPullRefresh(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = modifier,
        state = state,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                color = RidersColors.primary,
                containerColor = RidersColors.background,
            )
        },
    ) {
        content()
    }
}

@Composable
fun RidersEmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    image: Int? = null,
    imageSize: Dp = 40.dp,
    compactTop: Boolean = false,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.background)
            .padding(
                start = RidersSpacing.xl,
                top = if (compactTop) RidersSpacing.md else RidersSpacing.xl,
                end = RidersSpacing.xl,
                bottom = RidersSpacing.xl,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        if (image != null) {
            Image(
                painter = painterResource(image),
                contentDescription = null,
                modifier = Modifier.size(imageSize),
                contentScale = ContentScale.Fit,
            )
        }
        Text(title, style = RidersType.heading, color = RidersColors.text, textAlign = TextAlign.Center)
        Text(body, style = RidersType.body, color = RidersColors.textSecondary, textAlign = TextAlign.Center)
    }
}

fun isConnectionFailure(message: String?): Boolean {
    if (message.isNullOrBlank()) {
        return false
    }
    val text = message.lowercase()
    return "network request failed" in text || "timed out" in text || "check your connection" in text
}

@Suppress("UNUSED_PARAMETER")
@Composable
fun RidersNetworkNotice(
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    ReportNetworkNotice(active = true)
}

@Composable
fun RidersFailureNotice(
    message: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    if (isConnectionFailure(message)) {
        RidersNetworkNotice(onRetry = onRetry, modifier = modifier)
    } else {
        RidersErrorState(message = message, title = title, modifier = modifier)
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

fun Modifier.ridersFocusRing(focused: Boolean, color: Color = RidersColors.focusRing): Modifier {
    if (!focused) {
        return this
    }
    return this.drawBehind {
        val spread = 4.dp.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(-spread, -spread),
            size = Size(size.width + spread * 2, size.height + spread * 2),
            cornerRadius = CornerRadius(RidersRadius.md.toPx() + spread, RidersRadius.md.toPx() + spread),
        )
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
    val bringIntoView = remember { BringIntoViewRequester() }
    val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(focused, imeBottom) {
        if (focused && enabled) {
            bringIntoView.bringIntoView()
        }
    }
    val shape = RoundedCornerShape(RidersRadius.md)
    val borderColor = when {
        error != null -> RidersColors.error
        focused -> RidersColors.primary
        else -> RidersColors.border
    }
    val borderWidth = if (focused || error != null) 2.dp else 1.dp
    Column(modifier.bringIntoViewRequester(bringIntoView)) {
        Text(label, style = RidersType.captionStrong, color = RidersColors.text)
        Spacer(Modifier.height(RidersSpacing.md))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 58.dp)
                .ridersFocusRing(
                    focused = error != null || (focused && enabled),
                    color = if (error != null) RidersColors.errorRing else RidersColors.focusRing,
                )
                .background(if (enabled) RidersColors.background else RidersColors.surface, shape)
                .border(borderWidth, borderColor, shape)
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.lg),
            enabled = enabled,
            textStyle = ridersFieldTextStyle(if (enabled) RidersColors.text else RidersColors.textSecondary),
            keyboardOptions = keyboardOptions,
            visualTransformation = visualTransformation,
            singleLine = true,
            interactionSource = interaction,
            cursorBrush = SolidColor(RidersColors.primary),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = ridersFieldTextStyle(RidersColors.textSecondary))
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

internal fun ridersFieldTextStyle(color: Color): TextStyle = TextStyle(
    color = color,
    fontSize = 17.sp,
    fontWeight = FontWeight.Normal,
    lineHeight = TextUnit.Unspecified,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
)
