package com.riders.rider.core.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val accessTokenExpiresAt: String,
    val refreshTokenExpiresAt: String,
)

interface SessionStore {
    val session: StateFlow<AuthSession?>
    val refreshUncertain: StateFlow<Boolean>
    fun read(): AuthSession?
    fun write(session: AuthSession): Boolean
    fun clear()
    fun markRefreshUncertain()
}

class MemorySessionStore(initial: AuthSession? = null) : SessionStore {
    private val state = MutableStateFlow(initial)
    private val uncertain = MutableStateFlow(false)
    override val session: StateFlow<AuthSession?> = state.asStateFlow()
    override val refreshUncertain: StateFlow<Boolean> = uncertain.asStateFlow()
    override fun read(): AuthSession? = state.value
    override fun write(session: AuthSession): Boolean {
        state.value = session
        uncertain.value = false
        return true
    }
    override fun clear() {
        state.value = null
        uncertain.value = false
    }
    override fun markRefreshUncertain() {
        uncertain.value = true
    }
}
