package com.riders.rider.core.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

fun requireSafeApiUrl(value: String, debug: Boolean) {
    val url = value.toHttpUrlOrNull() ?: throw IllegalStateException("Invalid API address")
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "Invalid API address" }
    require(url.isHttps || (debug && isLocalDevelopmentHost(url.host))) { "The API must use HTTPS outside local development" }
}

internal fun isLocalDevelopmentHost(host: String): Boolean {
    if (host == "localhost" || host == "::1") return true
    val parts = host.split('.').map { it.toIntOrNull() ?: return false }
    if (parts.size != 4 || parts.any { it !in 0..255 }) return false
    return parts[0] == 127 || parts[0] == 10 ||
        (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168)
}
