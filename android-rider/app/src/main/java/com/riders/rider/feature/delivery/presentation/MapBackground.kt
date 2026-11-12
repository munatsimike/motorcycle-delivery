package com.riders.rider.feature.delivery.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Bundle
import android.view.View
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.view.doOnLayout
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MarkerOptions
import com.riders.rider.R
import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.data.FusedCurrentFix
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.neighborhoodZoom
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.min
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class MapBackgroundModel @Inject constructor(
    private val hub: RiderLocationHub,
    private val fixes: FusedCurrentFix,
) : ViewModel() {
    private val center = MutableStateFlow<GeoPoint?>(null)
    val known: StateFlow<GeoPoint?> = center.asStateFlow()
    private val settled = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = settled.asStateFlow()
    private var started = false

    /** One cached fix from the shared hub or the fused client. Does not subscribe to GPS. */
    fun resolve() {
        if (started) {
            return
        }
        started = true
        val published = hub.fixes.value?.fix
        if (published != null) {
            center.value = GeoPoint(published.latitude, published.longitude)
            settled.value = true
            return
        }
        viewModelScope.launch {
            val cached = fixes.cached()
            if (cached != null) {
                center.value = GeoPoint(cached.latitude, cached.longitude)
            }
            settled.value = true
            if (center.value != null) {
                return@launch
            }
            hub.fixes.collect { shared ->
                val fix = shared?.fix ?: return@collect
                if (center.value == null) {
                    center.value = GeoPoint(fix.latitude, fix.longitude)
                }
            }
        }
    }
}

/**
 * One preview map. A lite Google map is shown when a known location can be drawn.
 * The static image replaces it only when that map cannot be shown.
 * Pickup and drop-off full-screen maps do not use this while their own map is up.
 */
@Composable
fun MapBackground(
    modifier: Modifier = Modifier,
    pickup: GeoPoint? = null,
    dropoff: GeoPoint? = null,
    useKnownLocation: Boolean = true,
) {
    if (LocalInspectionMode.current || (!useKnownLocation && pickup == null && dropoff == null)) {
        MapBackgroundImage(modifier)
        return
    }
    val model: MapBackgroundModel = hiltViewModel()
    val known by model.known.collectAsStateWithLifecycle()
    val ready by model.ready.collectAsStateWithLifecycle()
    val explicit = remember(pickup, dropoff) { listOfNotNull(pickup, dropoff) }
    LaunchedEffect(useKnownLocation, explicit.isEmpty()) {
        if (useKnownLocation && explicit.isEmpty()) {
            model.resolve()
        }
    }
    val points = if (explicit.isNotEmpty()) explicit else known?.let { listOf(it) }.orEmpty()
    if (points.isEmpty()) {
        if (useKnownLocation && explicit.isEmpty() && !ready) {
            Box(modifier)
        } else {
            MapBackgroundImage(modifier)
        }
        return
    }
    val context = LocalContext.current
    val mapsAvailable = remember(context) {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }
    var failed by remember { mutableStateOf(false) }
    if (!mapsAvailable || failed) {
        MapBackgroundImage(modifier)
        return
    }
    DynamicPreviewMap(
        points = points,
        pickup = pickup,
        dropoff = dropoff,
        modifier = modifier,
        onFailed = { failed = true },
    )
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
private fun DynamicPreviewMap(
    points: List<GeoPoint>,
    pickup: GeoPoint?,
    dropoff: GeoPoint?,
    modifier: Modifier,
    onFailed: () -> Unit,
) {
    val context = LocalContext.current
    val mapView = remember {
        runCatching {
            MapView(context, GoogleMapOptions().liteMode(true)).apply {
                isClickable = false
                isFocusable = false
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                setOnTouchListener { _, _ -> false }
                onCreate(Bundle())
            }
        }.getOrNull()
    }
    if (mapView == null) {
        LaunchedEffect(Unit) { onFailed() }
        return
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, mapView) {
        var running = false
        fun start() {
            if (running) {
                return
            }
            val started = runCatching {
                mapView.onStart()
                mapView.onResume()
            }
            if (started.isFailure) {
                onFailed()
                return
            }
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
            runCatching { mapView.onDestroy() }
        }
    }
    val styles = remember(context) { RiderMapStyles.load(context) }
    val theme = remember(context) { RiderMapThemeStore.read(context) }
    AndroidView(
        modifier = modifier,
        factory = { mapView },
        update = { view ->
            val key = points.joinToString(";") { "${it.latitude},${it.longitude}" }
            if (view.tag == key) {
                return@AndroidView
            }
            view.getMapAsync { map ->
                runCatching {
                    map.uiSettings.apply {
                        setAllGesturesEnabled(false)
                        isZoomControlsEnabled = false
                        isCompassEnabled = false
                        isMyLocationButtonEnabled = false
                        isMapToolbarEnabled = false
                    }
                    runCatching { styles.optionsFor(theme)?.let { map.setMapStyle(it) } }
                    map.clear()
                    runCatching { placePreviewMarkers(map, context, pickup, dropoff, points) }
                }.onFailure {
                    onFailed()
                    return@getMapAsync
                }
                view.doOnLayout { laidOut ->
                    val span = min(laidOut.width, laidOut.height)
                    if (span <= 0 || view.tag == key) {
                        return@doOnLayout
                    }
                    val framed = runCatching { framePreview(map, points, span, laidOut.context.resources.displayMetrics.density) }
                    if (framed.isFailure) {
                        onFailed()
                        return@doOnLayout
                    }
                    view.tag = key
                    view.invalidate()
                }
            }
        },
    )
}

private fun framePreview(map: GoogleMap, points: List<GeoPoint>, spanPx: Int, density: Float) {
    if (points.size == 1) {
        map.moveCamera(
            CameraUpdateFactory.newLatLngZoom(points.first().toLatLng(), neighborhoodZoom(spanPx)),
        )
        return
    }
    val bounds = LatLngBounds.builder()
    points.forEach { bounds.include(it.toLatLng()) }
    val padding = (24f * density).toInt().coerceAtLeast(1)
    runCatching {
        map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), padding))
    }.getOrElse {
        map.moveCamera(
            CameraUpdateFactory.newLatLngZoom(points.first().toLatLng(), neighborhoodZoom(spanPx)),
        )
    }
}

private fun placePreviewMarkers(
    map: GoogleMap,
    context: android.content.Context,
    pickup: GeoPoint?,
    dropoff: GeoPoint?,
    points: List<GeoPoint>,
) {
    pickup?.let { point ->
        map.addMarker(
            MarkerOptions()
                .position(point.toLatLng())
                .anchor(0.5f, 1f)
                .icon(locationPin(context, R.drawable.ic_solid_pickup_location)),
        )
    }
    dropoff?.let { point ->
        map.addMarker(
            MarkerOptions()
                .position(point.toLatLng())
                .anchor(0.5f, 1f)
                .icon(locationPin(context, R.drawable.ic_solid_dropoff_location)),
        )
    }
    if (pickup == null && dropoff == null) {
        points.firstOrNull()?.let { point ->
            map.addMarker(
                MarkerOptions()
                    .position(point.toLatLng())
                    .anchor(0.5f, 1f)
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN)),
            )
        }
    }
}

private fun locationPin(context: android.content.Context, drawableId: Int): BitmapDescriptor? {
    val drawable = ContextCompat.getDrawable(context, drawableId)?.mutate() ?: return null
    val density = context.resources.displayMetrics.density
    val width = (32f * density).toInt().coerceAtLeast(1)
    val height = (39f * density).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, width, height)
    drawable.draw(Canvas(bitmap))
    return runCatching { BitmapDescriptorFactory.fromBitmap(bitmap) }.getOrNull()
}

private fun GeoPoint.toLatLng(): LatLng = LatLng(latitude, longitude)
