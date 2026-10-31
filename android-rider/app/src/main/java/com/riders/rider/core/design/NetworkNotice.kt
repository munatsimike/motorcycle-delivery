package com.riders.rider.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.runtime.mutableStateMapOf
import com.riders.rider.R

const val NETWORK_UNAVAILABLE_MESSAGE = "Network unavailable. Check your connection and try again."

private val SnackbarCharcoal = Color(0xFF2C3330)

private class NetworkNoticeState {
    val reporters: SnapshotStateMap<Any, Unit> = mutableStateMapOf()
    var clearance by mutableStateOf(0.dp)
}

private val LocalNetworkNotice = staticCompositionLocalOf<NetworkNoticeState?> { null }

@Composable
internal fun NetworkNoticeHost(content: @Composable () -> Unit) {
    val state = remember { NetworkNoticeState() }
    CompositionLocalProvider(LocalNetworkNotice provides state) {
        Box(Modifier.fillMaxSize()) {
            content()
            if (state.reporters.isNotEmpty()) {
                NetworkSnackbar(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(bottom = state.clearance)
                        .padding(
                            start = RidersSpacing.lg,
                            end = RidersSpacing.lg,
                            bottom = RidersSpacing.lg,
                        ),
                )
            }
        }
    }
}

@Composable
internal fun ReportNetworkNotice(active: Boolean) {
    val state = LocalNetworkNotice.current ?: return
    val id = remember { Any() }
    DisposableEffect(state, active) {
        if (active) {
            state.reporters[id] = Unit
        } else {
            state.reporters.remove(id)
        }
        onDispose { state.reporters.remove(id) }
    }
}

@Composable
fun NetworkSnackbarClearance(clearance: Dp) {
    val state = LocalNetworkNotice.current ?: return
    DisposableEffect(state, clearance) {
        val previous = state.clearance
        state.clearance = clearance
        onDispose { state.clearance = previous }
    }
}

@Composable
private fun NetworkSnackbar(modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(RidersRadius.md)
    Row(
        modifier
            .shadow(6.dp, shape)
            .clip(shape)
            .background(SnackbarCharcoal)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_wifi_off),
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(22.dp),
        )
        Text(
            NETWORK_UNAVAILABLE_MESSAGE,
            style = RidersType.caption,
            color = Color.White,
            modifier = Modifier.weight(1f),
        )
    }
}
