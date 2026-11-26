package com.riders.rider.core.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.util.UUID

/** Opt-in for temporary feedback only. Keep initial-load errors and validation inline. */
@Composable
fun RidersTransientNotice(
    message: String?,
    passive: Boolean = false,
) {
    val text = message?.takeIf { it.isNotBlank() }
    val transportFailure = isConnectionFailure(text)
    val availability = rememberNetworkStatus(transportFailure = transportFailure, backendFailure = false)
    val show = LocalNotificationSnackbar.current
    var handled by remember(text) { mutableStateOf(false) }
    ReportNetworkNotice(active = text != null && availability == NetworkAvailability.Disconnected)
    LaunchedEffect(text, availability) {
        if (text == null || handled) return@LaunchedEffect
        if (availability == NetworkAvailability.Disconnected) {
            handled = true
        } else if (!transportFailure || availability == NetworkAvailability.BackendUnavailable) {
            handled = true
            show(NotificationMessage(
                id = UUID.randomUUID().toString(),
                text = text,
                passive = passive,
                temporary = true,
            ))
        }
    }
}
