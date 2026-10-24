package com.riders.rider.feature.offers.notification

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.riders.rider.MainActivity
import com.riders.rider.R
import com.riders.rider.feature.offers.domain.ACCEPTED_BID_BODY
import com.riders.rider.feature.offers.domain.ACCEPTED_BID_EXTRA_DELIVERY_ID
import com.riders.rider.feature.offers.domain.ACCEPTED_BID_TITLE
import com.riders.rider.feature.offers.domain.OFFER_CHANNEL_ID
import com.riders.rider.feature.offers.domain.OFFER_EXTRA_ASSIGNMENT_ID
import com.riders.rider.feature.offers.domain.OFFER_NOTICE_BODY
import com.riders.rider.feature.offers.domain.OFFER_NOTICE_TITLE
import com.riders.rider.feature.offers.domain.offerNotificationId
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OfferNotificationPoster @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun notificationsEnabled(): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun show(assignmentId: String) {
        if (!prepareChannel()) {
            return
        }
        val open = Intent(context, MainActivity::class.java).apply {
            putExtra(OFFER_EXTRA_ASSIGNMENT_ID, assignmentId)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            offerNotificationId(assignmentId),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, OFFER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_bell)
            .setContentTitle(OFFER_NOTICE_TITLE)
            .setContentText(OFFER_NOTICE_BODY)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(offerNotificationId(assignmentId), notification)
    }

    fun showAccepted(deliveryId: String) {
        if (!prepareChannel()) {
            return
        }
        val open = Intent(context, MainActivity::class.java).apply {
            putExtra(ACCEPTED_BID_EXTRA_DELIVERY_ID, deliveryId)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            offerNotificationId("accepted:$deliveryId"),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, OFFER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_bell)
            .setContentTitle(ACCEPTED_BID_TITLE)
            .setContentText(ACCEPTED_BID_BODY)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(offerNotificationId("accepted:$deliveryId"), notification)
    }

    private fun prepareChannel(): Boolean {
        if (!notificationsEnabled()) {
            return false
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true
        }
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val channel = NotificationChannel(
            OFFER_CHANNEL_ID,
            "Delivery requests",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Alerts when a delivery request is offered to you"
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setSound(
                sound,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        return true
    }
}
