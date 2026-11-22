package com.riders.rider.core.design

import android.provider.Settings
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.riders.rider.R

object RidersMotion {
    const val DELIVERY_MS = 420
    const val BID_MS = 250
    const val TAB_MS = DELIVERY_MS
    const val PRESS_MS = 120
    const val CONFIRM_MS = 280
    const val CONTENT_MS = 160
    const val PRESS_SCALE = 0.985f
}

enum class RiderTransition {
    DeliveryForward,
    DeliveryBack,
    BidRise,
    TabFade,
}

fun motionDuration(preferredMillis: Int, animatorScale: Float, transitionScale: Float): Int {
    if (animatorScale <= 0f || transitionScale <= 0f) {
        return 0
    }
    return preferredMillis
}

fun motionEnabled(animatorScale: Float, transitionScale: Float): Boolean {
    return motionDuration(1, animatorScale, transitionScale) > 0
}

fun riderTransitionMillis(
    kind: RiderTransition,
    animatorScale: Float = 1f,
    transitionScale: Float = 1f,
): Int {
    val preferred = when (kind) {
        RiderTransition.DeliveryForward, RiderTransition.DeliveryBack -> RidersMotion.DELIVERY_MS
        RiderTransition.BidRise -> RidersMotion.BID_MS
        RiderTransition.TabFade -> RidersMotion.TAB_MS
    }
    return motionDuration(preferred, animatorScale, transitionScale)
}

fun offerPressScale(pressed: Boolean, enabled: Boolean): Float {
    return if (pressed && enabled) RidersMotion.PRESS_SCALE else 1f
}

fun acceptPressEnabled(canAccept: Boolean, confirmed: Boolean): Boolean = canAccept && !confirmed

fun acceptanceNavigationDelay(confirmed: Boolean, enabled: Boolean): Int {
    return if (confirmed && enabled) RidersMotion.CONFIRM_MS else 0
}

fun acceptanceConfirmationVisible(backendConfirmed: Boolean): Boolean = backendConfirmed

fun bidConfirmationVisible(backendConfirmed: Boolean): Boolean = backendConfirmed

fun animatesEntireOfferCard(): Boolean = false

data class RidersMotionScale(val animator: Float, val transition: Float) {
    val enabled: Boolean get() = motionEnabled(animator, transition)

    fun millis(kind: RiderTransition): Int = riderTransitionMillis(kind, animator, transition)

    fun duration(preferredMillis: Int): Int = motionDuration(preferredMillis, animator, transition)
}

@Composable
fun rememberRidersMotion(): RidersMotionScale {
    val context = LocalContext.current
    return remember {
        val resolver = context.contentResolver
        RidersMotionScale(
            animator = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f),
            transition = Settings.Global.getFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f),
        )
    }
}

@Composable
fun RidersChangingText(
    value: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    textAlign: TextAlign = TextAlign.Start,
    maxLines: Int = Int.MAX_VALUE,
) {
    val motion = rememberRidersMotion()
    val duration = motion.duration(RidersMotion.CONTENT_MS)
    AnimatedContent(
        targetState = value,
        modifier = modifier,
        transitionSpec = {
            ContentTransform(
                targetContentEnter = fadeIn(tween(duration)),
                initialContentExit = fadeOut(tween(duration)),
                sizeTransform = null,
            )
        },
        label = "changed-value",
    ) { text ->
        Text(text, style = style, color = color, textAlign = textAlign, maxLines = maxLines)
    }
}

@Composable
fun RidersConfirmation(message: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(RoundedCornerShape(RidersRadius.pill))
            .background(RidersColors.primaryLight)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_check),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = RidersColors.primaryDark,
        )
        Text(message, style = RidersType.bodyStrong, color = RidersColors.primaryDark)
    }
}
