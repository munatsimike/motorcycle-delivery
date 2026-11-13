package com.riders.rider.feature.offers.notification

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface OfferPushEntryPoint {
    fun pendingOffer(): PendingOffer
    fun offerPush(): OfferPushCoordinator
}

@Composable
fun rememberOfferPush(): OfferPushCoordinator {
    val context = LocalContext.current
    return remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext,
            OfferPushEntryPoint::class.java,
        ).offerPush()
    }
}

@Composable
fun rememberOfferInbox(): PendingOffer {
    val context = LocalContext.current
    return remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext,
            OfferPushEntryPoint::class.java,
        ).pendingOffer()
    }
}
