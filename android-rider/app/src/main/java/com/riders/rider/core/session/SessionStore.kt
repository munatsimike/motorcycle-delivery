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
    fun read(): AuthSession?
    fun write(session: AuthSession): Boolean
    fun clear()
}

class MemorySessionStore(initial: AuthSession? = null) : SessionStore {
    private val state = MutableStateFlow(initial)
    override val session: StateFlow<AuthSession?> = state.asStateFlow()
    override fun read(): AuthSession? = state.value
    override fun write(session: AuthSession): Boolean {
        state.value = session
        return true
    }
    override fun clear() {
        state.value = null
    }
}
