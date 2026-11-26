package com.riders.rider.core.session

import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val accessTokenExpiresAt: String,
    val refreshTokenExpiresAt: String,
)

data class SessionSnapshot(val identity: String, val session: AuthSession?)

fun newSessionIdentity(): String = UUID.randomUUID().toString()

interface SessionStore {
    val identity: StateFlow<String>
    fun snapshot(): SessionSnapshot = synchronized(this) { SessionSnapshot(identity.value, read()) }
    fun isCurrent(id: String): Boolean = synchronized(this) { identity.value == id && read() != null }
    fun writeIfCurrent(id: String, session: AuthSession): Boolean = synchronized(this) {
        identity.value == id && write(session)
    }
    fun clearIfCurrent(id: String): Boolean = synchronized(this) {
        if (identity.value != id) false else { clear(); true }
    }
    fun replaceIfCurrent(expected: SessionSnapshot, session: AuthSession): Boolean
    fun markUncertainIfCurrent(expected: SessionSnapshot) = synchronized(this) {
        if (snapshot() == expected) markRefreshUncertain()
    }

    val session: StateFlow<AuthSession?>
    val refreshUncertain: StateFlow<Boolean>
    fun read(): AuthSession?
    fun write(session: AuthSession): Boolean
    fun clear()
    fun markRefreshUncertain()
}

class MemorySessionStore(initial: AuthSession? = null) : SessionStore {
    private val state = MutableStateFlow(initial)
    private val generation = MutableStateFlow(newSessionIdentity())
    override val identity = generation.asStateFlow()
    private val uncertain = MutableStateFlow(false)
    override val session: StateFlow<AuthSession?> = state.asStateFlow()
    override val refreshUncertain: StateFlow<Boolean> = uncertain.asStateFlow()
    override fun read(): AuthSession? = state.value
    @Synchronized override fun write(session: AuthSession): Boolean {
        generation.value = newSessionIdentity()
        return replace(session)
    }
    @Synchronized override fun replaceIfCurrent(expected: SessionSnapshot, session: AuthSession): Boolean =
        snapshot() == expected && replace(session)
    private fun replace(session: AuthSession): Boolean {
        state.value = session
        uncertain.value = false
        return true
    }
    @Synchronized override fun clear() {
        generation.value = newSessionIdentity()
        state.value = null
        uncertain.value = false
    }
    @Synchronized override fun markRefreshUncertain() {
        uncertain.value = true
    }
}
