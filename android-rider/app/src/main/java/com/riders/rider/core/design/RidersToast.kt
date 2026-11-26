package com.riders.rider.core.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.riders.rider.R
import com.riders.rider.feature.delivery.domain.RIDERS_TOAST_DISMISS_MS
import com.riders.rider.feature.delivery.domain.acceptToast
import kotlinx.coroutines.delay

data class RidersToastEvent(
    val id: String,
    val message: String,
    val detail: String? = null,
    val dismissMs: Long = RIDERS_TOAST_DISMISS_MS,
)

val LocalRidersToast = staticCompositionLocalOf<(RidersToastEvent) -> Unit> { {} }

@Composable
fun RidersToastHost(content: @Composable () -> Unit) {
    val consumed = rememberSaveable { mutableStateOf("") }
    val current = remember { mutableStateOf<RidersToastEvent?>(null) }
    val show = remember(consumed, current) {
        { event: RidersToastEvent ->
            val accepted = acceptToast(event.id, consumed.value.ifBlank { null })
            if (accepted != null && event.message.isNotBlank()) {
                consumed.value = accepted
                current.value = event.copy(id = accepted)
            }
        }
    }
    val shown = current.value
    var message by rememberSaveable { mutableStateOf("") }
    var detail by rememberSaveable { mutableStateOf("") }
    if (shown != null) {
        message = shown.message
        detail = shown.detail.orEmpty()
    }
    val motion = rememberRidersMotion()
    val duration = motion.duration(RidersMotion.CONFIRM_MS)
    LaunchedEffect(shown?.id) {
        val active = current.value ?: return@LaunchedEffect
        delay(active.dismissMs)
        if (current.value?.id == active.id) {
            current.value = null
        }
    }
    CompositionLocalProvider(LocalRidersToast provides show) {
        Box(Modifier.fillMaxSize()) {
            content()
            AnimatedVisibility(
                visible = shown != null,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
                enter = slideInVertically(tween(duration)) { -it } + fadeIn(tween(duration)),
                exit = slideOutVertically(tween(duration)) { -it } + fadeOut(tween(duration)),
            ) {
                RidersToast(message, detail)
            }
        }
    }
}

@Composable
fun RidersToast(message: String, detail: String = "", modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.lg))
            .background(RidersColors.primary)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Box(
            Modifier
                .size(24.dp)
                .clip(CircleShape)
                .background(RidersColors.textInverse),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_check),
                contentDescription = null,
                tint = RidersColors.primary,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(message, style = RidersType.bodyStrong, color = RidersColors.textInverse)
            if (detail.isNotBlank()) {
                Text(detail, style = RidersType.body, color = RidersColors.textInverse)
            }
        }
    }
}
