package com.riders.rider.core.refresh

fun homePullIndicator(fromUser: Boolean, contentVisible: Boolean, errorVisible: Boolean): Boolean {
    return fromUser && (contentVisible || errorVisible)
}

fun homePageLoading(contentVisible: Boolean): Boolean = !contentVisible

fun goOnlineEnabled(pageLoading: Boolean, changingAvailability: Boolean): Boolean {
    return !pageLoading && !changingAvailability
}

data class ListedRefresh(
    val loading: Boolean,
    val refreshing: Boolean,
)

fun listedRefresh(fromUser: Boolean, blank: Boolean): ListedRefresh {
    return ListedRefresh(
        loading = blank,
        refreshing = fromUser && !blank,
    )
}

fun clearListedRefresh(owner: Int, current: Int, loading: Boolean, refreshing: Boolean): ListedRefresh {
    return if (owner == current) {
        ListedRefresh(loading = false, refreshing = false)
    } else {
        ListedRefresh(loading = loading, refreshing = refreshing)
    }
}
