package com.riders.rider.feature.availability

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.riders.rider.R
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.availability.domain.gpsFix
import com.riders.rider.feature.availability.domain.isDispatchUsable
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.availability.domain.locationUpdatePolicy
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@AndroidEntryPoint
class RiderLocationService : Service() {
    @Inject lateinit var availability: AvailabilityRepository
    @Inject lateinit var sessions: SessionStore
    @Inject lateinit var freshness: LocationFreshness
    @Inject lateinit var locations: RiderLocationHub

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val relay = LocationRelay()
    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var prompt: CancellationTokenSource? = null
    @Volatile private var updatesRequested = false
    @Volatile private var running = false
    @Volatile private var startTicket = 0
    @Volatile private var sessionIdentity: String? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val point = result.lastLocation ?: return
            scope.launch { deliver(point) }
        }
    }

    override fun onBind(intent: android.content.Intent?): IBinder? = null

    override fun onStartCommand(intent: android.content.Intent?, flags: Int, startId: Int): Int {
        startTicket = intent?.getIntExtra(EXTRA_START_TICKET, startTicket) ?: startTicket
        val identity = sessions.snapshot().identity
        if (!sessions.isCurrent(identity) || !fineLocationGranted()) {
            LocationServiceGate.fail(startTicket)
            availability.noteServiceStopped(startTicket, failed = true)
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            startAsForeground()
        } catch (_: SecurityException) {
            LocationServiceGate.fail(startTicket)
            availability.noteServiceStopped(startTicket, failed = true)
            stopSelf()
            return START_NOT_STICKY
        }
        sessionIdentity = identity
        running = true
        LocationServiceGate.confirmRunning(startTicket)
        availability.noteServiceRunning()
        // The service is started only after sharing was already approved. Register
        // before the network re-check so a slow or hung status call cannot leave
        // the foreground service with no Fused Location request.
        val listening = beginUpdates()
        requestPromptFix()
        scope.launch {
            if (!authorized() || (!listening && !beginUpdates())) {
                stopSharing()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        LocationServiceGate.markStopped(startTicket)
        availability.noteServiceStopped(startTicket)
        prompt?.cancel()
        runCatching { client.removeLocationUpdates(callback) }
        updatesRequested = false
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun authorized(): Boolean {
        if (sessionIdentity?.let(sessions::isCurrent) != true || !fineLocationGranted()) {
            return false
        }
        return availability.sharingStillAllowed()
    }

    private fun beginUpdates(): Boolean {
        if (!running || !fineLocationGranted()) {
            return false
        }
        if (updatesRequested) {
            return true
        }
        val policy = locationUpdatePolicy()
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, policy.intervalMillis)
            .setMinUpdateIntervalMillis(policy.minIntervalMillis)
            .setMaxUpdateDelayMillis(policy.maxUpdateDelayMillis)
            .setGranularity(Granularity.GRANULARITY_FINE)
            .setWaitForAccurateLocation(false)
            .build()
        return try {
            updatesRequested = true
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
                .addOnFailureListener {
                    updatesRequested = false
                    if (running) scope.launch { stopSharing() }
                }
            true
        } catch (_: SecurityException) {
            updatesRequested = false
            false
        }
    }

    private fun requestPromptFix() {
        if (!running || !fineLocationGranted()) {
            return
        }
        val token = CancellationTokenSource()
        prompt?.cancel()
        prompt = token
        try {
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
                .addOnSuccessListener { point ->
                    if (!running || prompt !== token) {
                        return@addOnSuccessListener
                    }
                    if (point != null) {
                        scope.launch { deliver(point) }
                    } else {
                        readCachedFix()
                    }
                }
        } catch (_: SecurityException) {
            scope.launch { stopSharing() }
        }
    }

    private fun readCachedFix() {
        try {
            client.lastLocation
                .addOnSuccessListener { cached ->
                    if (!running) {
                        return@addOnSuccessListener
                    }
                    val age = cached?.let { System.currentTimeMillis() - it.time }
                    val accuracy = cached?.let { if (it.hasAccuracy()) it.accuracy else null }
                    if (cached != null && age != null && isDispatchUsable(age, accuracy)) {
                        scope.launch { deliver(cached) }
                    } else {
                        scope.launch { availability.noteFixMissing() }
                    }
                }
                .addOnFailureListener {
                    if (running) {
                        scope.launch { availability.noteFixMissing() }
                    }
                }
        } catch (_: SecurityException) {
            scope.launch { stopSharing() }
        }
    }

    private suspend fun deliver(point: Location) {
        if (!running) {
            return
        }
        if (!fineLocationGranted() || sessionIdentity?.let(sessions::isCurrent) != true) {
            freshness.invalidate()
            stopSharing()
            return
        }
        val age = System.currentTimeMillis() - point.time
        val accuracy = if (point.hasAccuracy()) point.accuracy else null
        if (isDispatchUsable(age, accuracy)) {
            locations.publish(gpsFix(point), point.time)
        } else {
            availability.noteUnusableFix()
        }
        relay.handle(
            active = true,
            fix = gpsFix(point),
            ageMillis = age,
            accuracyMeters = if (point.hasAccuracy()) point.accuracy else null,
        ) { fix ->
            sessionIdentity?.let { availability.upload(fix, it) } ?: false
        }
    }

    private suspend fun stopSharing() {
        if (!running) {
            return
        }
        running = false
        freshness.invalidate()
        withContext(Dispatchers.Main) {
            prompt?.cancel()
            runCatching { client.removeLocationUpdates(callback) }
            updatesRequested = false
            ServiceCompat.stopForeground(this@RiderLocationService, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun startAsForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, getString(R.string.location_channel), NotificationManager.IMPORTANCE_LOW)
            channel.setShowBadge(false)
            manager.createNotificationChannel(channel)
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_riders)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.location_notice))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        ServiceCompat.startForeground(this, NOTICE_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    }

    companion object {
        const val ACTION_SHARE = "com.riders.rider.action.SHARE_LOCATION"
        const val EXTRA_START_TICKET = "com.riders.rider.extra.LOCATION_START_TICKET"
        private const val CHANNEL = "rider_location"
        private const val NOTICE_ID = 41
    }
}
