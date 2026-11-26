package com.riders.rider

import android.app.Application
import com.riders.rider.core.session.SessionCleanup
import com.riders.rider.core.session.SessionStore
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect

@HiltAndroidApp
class RiderApplication : Application() {
    @Inject lateinit var sessions: SessionStore
    @Inject lateinit var cleanup: SessionCleanup
    override fun onCreate() {
        super.onCreate()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            sessions.identity.collect { cleanup.prepare(it) }
        }
    }
}
