package com.riders.rider.feature.delivery.presentation

import android.os.Bundle
import android.view.View
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.doOnLayout
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.model.LatLng
import com.riders.rider.R
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.delivery.domain.neighborhoodZoom
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.min

@HiltViewModel
class MapBackgroundModel @Inject constructor(
    hub: RiderLocationHub,
) : ViewModel() {
    val fixes = hub.fixes
}

/**
 * Decorative road map for screens that used the static map image.
 * Uses a real rider fix already shared by the location service. With no fresh
 * fix, the original image stays in place. The camera does not follow later fixes.
 */
@Composable
fun MapBackground(modifier: Modifier = Modifier) {
    if (LocalInspectionMode.current) {
        MapBackgroundImage(modifier)
        return
    }
    val model: MapBackgroundModel = hiltViewModel()
    val shared by model.fixes.collectAsStateWithLifecycle()
    var center by remember { mutableStateOf<GpsFix?>(null) }
    LaunchedEffect(shared) {
        if (center != null) {
            return@LaunchedEffect
        }
        val current = shared ?: return@LaunchedEffect
        val age = System.currentTimeMillis() - current.atMillis
        if (age in 0..LOCATION_MAX_FIX_AGE_MS) {
            center = current.fix
        }
    }
    val point = center
    if (point == null) {
        MapBackgroundImage(modifier)
    } else {
        StaticRoadMap(point.latitude, point.longitude, modifier)
    }
}

@Composable
private fun MapBackgroundImage(modifier: Modifier) {
    Image(
        painter = painterResource(R.drawable.map_background),
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.Crop,
    )
}

@Composable
private fun StaticRoadMap(latitude: Double, longitude: Double, modifier: Modifier) {
    val context = LocalContext.current
    val mapView = remember {
        MapView(context, GoogleMapOptions().liteMode(true)).apply {
            isClickable = false
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            setOnTouchListener { _, _ -> false }
            onCreate(Bundle())
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, mapView) {
        var running = false
        fun start() {
            if (running) {
                return
            }
            mapView.onStart()
            mapView.onResume()
            running = true
        }
        fun stop() {
            if (!running) {
                return
            }
            mapView.onPause()
            mapView.onStop()
            running = false
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> start()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> stop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            start()
        }
        onDispose {
            lifecycle.removeObserver(observer)
            stop()
            mapView.onDestroy()
        }
    }
    AndroidView(
        modifier = modifier,
        factory = { mapView },
        update = { view ->
            val key = "$latitude,$longitude"
            if (view.tag == key) {
                return@AndroidView
            }
            view.getMapAsync { map ->
                map.uiSettings.apply {
                    setAllGesturesEnabled(false)
                    isZoomControlsEnabled = false
                    isCompassEnabled = false
                    isMyLocationButtonEnabled = false
                    isMapToolbarEnabled = false
                }
                view.doOnLayout { laidOut ->
                    val span = min(laidOut.width, laidOut.height)
                    if (span <= 0 || view.tag == key) {
                        return@doOnLayout
                    }
                    runCatching {
                        map.moveCamera(
                            CameraUpdateFactory.newLatLngZoom(
                                LatLng(latitude, longitude),
                                neighborhoodZoom(span),
                            ),
                        )
                    }
                    view.tag = key
                }
            }
        },
    )
}
