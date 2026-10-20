package com.riders.rider.feature.auth.domain

interface BiometricPreference {
    fun isEnabled(): Boolean
    fun isDeclined(): Boolean
    fun enable()
    fun decline()
    fun disable()
    fun clear()
}

class MemoryBiometricPreference : BiometricPreference {
    private var enabled = false
    private var declined = false

    override fun isEnabled(): Boolean = enabled

    override fun isDeclined(): Boolean = declined

    override fun enable() {
        enabled = true
        declined = false
    }

    override fun decline() {
        declined = true
    }

    override fun disable() {
        enabled = false
    }

    override fun clear() {
        enabled = false
        declined = false
    }
}
