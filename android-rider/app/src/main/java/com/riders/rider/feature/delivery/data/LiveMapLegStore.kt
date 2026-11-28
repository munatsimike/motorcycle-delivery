package com.riders.rider.feature.delivery.data

import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.delivery.domain.LiveMapLegCache
import com.riders.rider.feature.delivery.domain.LiveMapLegKey
import com.riders.rider.feature.delivery.domain.LiveMapLegState
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LiveMapLegStore @Inject constructor(private val sessions: SessionStore) {
    private val cache = LiveMapLegCache()
    fun identity(): String = sessions.identity.value
    fun isCurrent(owner: String): Boolean = sessions.identity.value == owner && sessions.session.value != null
    fun get(owner: String, key: LiveMapLegKey): LiveMapLegState? =
        if (isCurrent(owner)) cache.get(owner, key) else null
    fun clear() = cache.clear()
}
