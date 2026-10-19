package com.riders.rider.core.di

import android.content.Context
import androidx.room.Room
import com.riders.rider.BuildConfig
import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.RefreshAuthenticator
import com.riders.rider.core.network.RefreshRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.SessionResponse
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.performRefresh
import com.riders.rider.core.network.retrofit
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.EncryptedSessionStore
import com.riders.rider.core.session.SessionStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Interceptor
import javax.inject.Singleton

class ApiGraph(
    val auth: AuthService,
    val rider: RiderService,
)

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun sessionStore(store: EncryptedSessionStore): SessionStore = store

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): RiderDatabase {
        return Room.databaseBuilder(context, RiderDatabase::class.java, "rider.db").build()
    }

    @Provides
    @Singleton
    fun apiGraph(store: SessionStore): ApiGraph {
        val baseUrl = BuildConfig.API_BASE_URL
        val refreshApi = retrofit(baseUrl, httpClient()).create(AuthService::class.java)
        val authed = httpClient {
            addInterceptor(Interceptor { chain ->
                val request = chain.request()
                val path = request.url.encodedPath
                val token = store.read()?.accessToken
                val open = path.contains("/auth/rider/") || path.endsWith("/auth/session/refresh")
                if (open || token.isNullOrEmpty()) {
                    chain.proceed(request)
                } else {
                    chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
                }
            })
            authenticator(RefreshAuthenticator(store) { refreshToken ->
                performRefresh { refreshApi.refresh(RefreshRequest(refreshToken)).toSession() }
            })
        }
        val retrofit = retrofit(baseUrl, authed)
        return ApiGraph(
            auth = retrofit.create(AuthService::class.java),
            rider = retrofit.create(RiderService::class.java),
        )
    }

    @Provides
    fun authService(graph: ApiGraph): AuthService = graph.auth

    @Provides
    fun riderService(graph: ApiGraph): RiderService = graph.rider
}

private fun SessionResponse.toSession(): AuthSession {
    return AuthSession(accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt)
}
