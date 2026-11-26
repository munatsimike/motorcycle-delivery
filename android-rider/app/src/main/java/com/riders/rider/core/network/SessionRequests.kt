package com.riders.rider.core.network

import com.riders.rider.core.session.SessionStore
import okhttp3.Call
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

class SessionChangedException : IOException("Session changed")
data class SessionRequest(val identity: String)

private fun isPublic(path: String): Boolean = path.contains("/auth/rider/") ||
    path.endsWith("/auth/places") || path.endsWith("/auth/places/detail") || path.endsWith("/auth/session/refresh")

/** Bind at call creation, not when an OkHttp worker eventually runs. */
fun sessionBoundCalls(client: Call.Factory, store: SessionStore): Call.Factory = Call.Factory { request ->
    if (isPublic(request.url.encodedPath)) client.newCall(request)
    else client.newCall(request.newBuilder().tag(SessionRequest::class.java, SessionRequest(store.snapshot().identity)).build())
}

class SessionRequestInterceptor(private val store: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (isPublic(request.url.encodedPath)) return chain.proceed(request)
        val snapshot = store.snapshot()
        val session = snapshot.session ?: throw SessionChangedException()
        if (request.tag(SessionRequest::class.java)?.identity != snapshot.identity) throw SessionChangedException()
        val response = chain.proceed(request.newBuilder().header("Authorization", "Bearer ${session.accessToken}").build())
        // A rejected refresh may legitimately clear the session and return a 401.
        if (!store.isCurrent(snapshot.identity) && !(response.code == 401 && store.read() == null)) {
            response.close()
            throw SessionChangedException()
        }
        return response
    }
}

/** Also check follow-up requests immediately before network transmission. */
class SessionNetworkInterceptor(private val store: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val tag = request.tag(SessionRequest::class.java)
        if (tag != null && !store.isCurrent(tag.identity)) throw SessionChangedException()
        return chain.proceed(request)
    }
}
