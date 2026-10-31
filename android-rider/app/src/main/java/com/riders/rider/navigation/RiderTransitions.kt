package com.riders.rider.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.ui.Alignment

fun deliveryForwardEnter(durationMillis: Int): EnterTransition {
    if (durationMillis <= 0) {
        return EnterTransition.None
    }
    return slideInHorizontally(tween(durationMillis)) { fullWidth -> fullWidth } + fadeIn(tween(durationMillis))
}

fun deliveryForwardExit(durationMillis: Int): ExitTransition {
    if (durationMillis <= 0) {
        return ExitTransition.None
    }
    return slideOutHorizontally(tween(durationMillis)) { fullWidth -> -fullWidth / 6 } + fadeOut(tween(durationMillis))
}

fun deliveryBackEnter(durationMillis: Int): EnterTransition {
    if (durationMillis <= 0) {
        return EnterTransition.None
    }
    return slideInHorizontally(tween(durationMillis)) { fullWidth -> -fullWidth / 6 } + fadeIn(tween(durationMillis))
}

fun deliveryBackExit(durationMillis: Int): ExitTransition {
    if (durationMillis <= 0) {
        return ExitTransition.None
    }
    return slideOutHorizontally(tween(durationMillis)) { fullWidth -> fullWidth } + fadeOut(tween(durationMillis))
}

fun bidRiseEnter(durationMillis: Int): EnterTransition {
    if (durationMillis <= 0) {
        return EnterTransition.None
    }
    return slideInVertically(tween(durationMillis)) { fullHeight -> fullHeight / 8 } + fadeIn(tween(durationMillis))
}

fun bidRiseExit(durationMillis: Int): ExitTransition {
    if (durationMillis <= 0) {
        return ExitTransition.None
    }
    return slideOutVertically(tween(durationMillis)) { fullHeight -> fullHeight / 8 } + fadeOut(tween(durationMillis))
}

fun bidOptionsEnter(durationMillis: Int): EnterTransition {
    if (durationMillis <= 0) {
        return EnterTransition.None
    }
    return fadeIn(tween(durationMillis, easing = FastOutSlowInEasing)) +
        expandVertically(tween(durationMillis, easing = FastOutSlowInEasing), expandFrom = Alignment.Top) +
        slideInVertically(tween(durationMillis, easing = FastOutSlowInEasing)) { fullHeight -> fullHeight / 8 }
}

fun bidOptionsExit(durationMillis: Int): ExitTransition {
    if (durationMillis <= 0) {
        return ExitTransition.None
    }
    return fadeOut(tween(durationMillis, easing = FastOutSlowInEasing)) +
        shrinkVertically(tween(durationMillis, easing = FastOutSlowInEasing), shrinkTowards = Alignment.Top) +
        slideOutVertically(tween(durationMillis, easing = FastOutSlowInEasing)) { fullHeight -> fullHeight / 8 }
}

fun routeOpensDelivery(route: String?): Boolean = route?.startsWith("delivery/") == true
