package com.riders.rider.core.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.riders.rider.R
import kotlinx.coroutines.delay
import android.os.SystemClock
import androidx.lifecycle.compose.collectAsStateWithLifecycle

data class NotificationMessage(
    val id: String,
    val text: String,
    val passive: Boolean = false,
    val temporary: Boolean = false,
)
val LocalNotificationSnackbar = staticCompositionLocalOf<(NotificationMessage) -> Unit> { {} }
private class NoticeClearance { var bottom by mutableStateOf(0.dp) }
private val LocalNoticeClearance = staticCompositionLocalOf<NoticeClearance?> { null }

@Composable
fun NotificationSnackbarClearance(bottom: Dp) {
    val state = LocalNoticeClearance.current ?: return
    DisposableEffect(state, bottom) {
        state.bottom = bottom
        onDispose { state.bottom = 0.dp }
    }
}

@Composable
fun NotificationSnackbarHost(
    incoming: NotificationMessage?,
    onConsumed: (NotificationMessage) -> Unit,
    suppress: Boolean = false,
    content: @Composable () -> Unit,
) {
    var active by remember { mutableStateOf<NotificationMessage?>(null) }
    var lastMessage by remember { mutableStateOf<NotificationMessage?>(null) }
    val link by RiderNetwork.link.collectAsStateWithLifecycle()
    val hidden = suppress || link == NetworkLink.Disconnected
    val passiveShown = remember { LinkedHashMap<String, Long>() }
    val clearance = remember { NoticeClearance() }
    val show: (NotificationMessage) -> Unit = { message ->
        val now = SystemClock.elapsedRealtime()
        val recentlyShown = passiveShown[message.text]?.let { now - it < 60_000L } == true
        if (!hidden && active?.id != message.id &&
            !(message.temporary && active?.temporary == true && active?.text == message.text) &&
            (!message.passive || !recentlyShown)) {
            if (message.passive) {
                passiveShown[message.text] = now
                if (passiveShown.size > 64) passiveShown.remove(passiveShown.keys.first())
            }
            lastMessage = message
            active = message
        }
    }
    LaunchedEffect(incoming, hidden) {
        if (incoming != null && !hidden) {
            show(incoming)
            onConsumed(incoming)
        }
    }
    LaunchedEffect(hidden) {
        if (hidden) active = null
    }
    LaunchedEffect(active) {
        if (active != null) { delay(6000L); active = null }
    }
    CompositionLocalProvider(LocalNotificationSnackbar provides show, LocalNoticeClearance provides clearance) {
        Box(Modifier.fillMaxSize()) {
            content()
            AnimatedVisibility(
                visible = active != null && !hidden,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().imePadding()
                    .padding(bottom = clearance.bottom).padding(horizontal = 16.dp, vertical = 12.dp),
                enter = slideInVertically { it }, exit = slideOutVertically { it },
            ) {
                Snackbar(
                    shape = RoundedCornerShape(RidersRadius.md),
                    containerColor = Color(0xFF2C3330), contentColor = Color.White,
                    dismissAction = {
                        IconButton(onClick = { active = null }) {
                            Icon(painterResource(R.drawable.ic_close), contentDescription = "Dismiss notification", tint = Color.White)
                        }
                    },
                ) { Text(lastMessage?.text.orEmpty()) }
            }
        }
    }
}
