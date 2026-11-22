package com.riders.rider.feature.availability.domain

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocationFreshness @Inject constructor() {
    @Volatile private var confirmedAtMillis: Long? = null

    fun markConfirmed(nowMillis: Long) {
        confirmedAtMillis = nowMillis
    }

    fun invalidate() {
        confirmedAtMillis = null
    }

    fun canAccept(nowMillis: Long): Boolean = locationIsFresh(nowMillis, confirmedAtMillis)
}
