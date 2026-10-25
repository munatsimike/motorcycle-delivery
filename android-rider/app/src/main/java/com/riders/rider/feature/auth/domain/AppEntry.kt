package com.riders.rider.feature.auth.domain

enum class AppEntry {
    SignedOut,
    Home,
}

fun appEntry(hasStoredSession: Boolean): AppEntry {
    return if (hasStoredSession) AppEntry.Home else AppEntry.SignedOut
}
