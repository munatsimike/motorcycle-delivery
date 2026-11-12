package com.riders.rider.feature.offers.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.RoundCap
import com.google.maps.android.compose.CameraMoveStartedReason
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.withMinimumCameraSpan
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.presentation.pickupPinColor
import com.riders.rider.feature.delivery.presentation.dropoffPinColor
import com.riders.rider.feature.delivery.presentation.RiderMapStyles
import com.riders.rider.feature.delivery.presentation.RiderMapThemeStore
import com.riders.rider.feature.delivery.presentation.riderMarkerIcon
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

// Reusable Google Maps route view for bids and other rider screens.
// Pin shapes use the same drawable assets as the delivery cards.
private const val FRAME_LOOSEN = 0.08

@Composable
fun RequestRouteMap(
    deliveryId: String,
    pickup: GeoPoint?,
    dropoff: GeoPoint?,
    line: List<GeoPoint>,
    modifier: Modifier = Modifier,
    sheetOverlap: Dp = 0.dp,
    recenter: Int = 0,
    rider: GeoPoint? = null,
    waitingForLocation: Boolean = false,
    approachLabel: String? = null,
    routeWidth: Dp = 5.dp,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val mapStyles = remember(context) { RiderMapStyles.load(context) }
    val mapTheme = RiderMapThemeStore.read(context)
    val initial = pickup ?: dropoff
    val camera = rememberCameraPositionState {
        if (initial != null) {
            position = CameraPosition.fromLatLngZoom(LatLng(initial.latitude, initial.longitude), 13f)
        }
    }
    var mapLoaded by remember { mutableStateOf(false) }
    var mapWidth by remember { mutableStateOf(0) }
    var mapHeight by remember { mutableStateOf(0) }
    var userMoved by remember(deliveryId) { mutableStateOf(false) }
    var seenRecenter by remember { mutableIntStateOf(recenter) }
    var framedRoute by remember(deliveryId) { mutableStateOf(false) }
    var pickupIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var dropoffIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var framedRider by remember(deliveryId) { mutableStateOf(false) }
    val riderGate = rider != null || framedRider
    val road = line.filter { it.latitude.isFinite() && it.longitude.isFinite() }
    val routeReady = road.size > 1
    val routeGate = routeReady || framedRoute
    val boundsPadding = collectionMarkerPaddingPx(12f, density.density)
    val stroke = with(density) { routeWidth.toPx() }
    val riderMarker = remember(approachLabel, mapLoaded) {
        if (mapLoaded) riderMarkerIcon(context, approachLabel) else null
    }
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }

    LaunchedEffect(deliveryId, pickup, dropoff, routeGate, riderGate, mapLoaded, mapWidth, mapHeight, recenter, sheetOverlap) {
        val centering = recenter != seenRecenter
        if (!mapLoaded || mapWidth <= 0 || mapHeight <= 0 || (userMoved && !centering)) {
            return@LaunchedEffect
        }
        if (centering) {
            seenRecenter = recenter
            userMoved = false
        }
        if (routeReady) {
            framedRoute = true
        }
        if (rider != null) {
            framedRider = true
        }
        val framed = ArrayList<GeoPoint>(road.size + 1)
        if (routeReady) {
            framed.addAll(road)
        }
        if (rider != null && pickup != null) {
            framed.add(pickup)
        }
        val frame = collectionCameraFrame(
            rider ?: dropoff,
            if (rider != null) dropoff else pickup,
            framed,
        ) ?: return@LaunchedEffect
        val update = CameraUpdateFactory.newLatLngBounds(
            loosened(withMinimumCameraSpan(frame.points)),
            boundsPadding,
        )
        runCatching { camera.animate(update, 450) }
    }

    LaunchedEffect(road.size) {
        if (road.size > 1) {
            Log.i("CollectedRoute", "drawing points=${road.size}")
        }
    }
    if (initial != null) {
        Box(modifier) {
        GoogleMap(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged {
                    mapWidth = it.width
                    mapHeight = it.height
                },
            cameraPositionState = camera,
            contentPadding = PaddingValues(
                start = 40.dp,
                top = statusTop + 64.dp,
                end = 40.dp,
                bottom = sheetOverlap + 28.dp,
            ),
            properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyles.optionsFor(mapTheme)),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                compassEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
                rotationGesturesEnabled = false,
                tiltGesturesEnabled = false,
            ),
            onMapLoaded = {
                mapLoaded = true
                if (pickupIcon == null) {
                    pickupIcon = locationDrawableMarker(context, R.drawable.ic_solid_pickup_location)
                    dropoffIcon = locationDrawableMarker(context, R.drawable.ic_solid_dropoff_location)
                }
            },
        ) {
            if (road.size > 1) {
                Polyline(
                    points = road.map { LatLng(it.latitude, it.longitude) },
                    color = dropoffPinColor,
                    width = stroke,
                    jointType = JointType.ROUND,
                    startCap = RoundCap(),
                    endCap = RoundCap(),
                    geodesic = true,
                    zIndex = 1f,
                )
            }
            if (pickup != null && pickupIcon != null) {
                Marker(
                    state = remember(pickup) { MarkerState(LatLng(pickup.latitude, pickup.longitude)) },
                    icon = pickupIcon,
                    anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.5f),
                    zIndex = 1f,
                )
            }
            if (dropoff != null && dropoffIcon != null) {
                Marker(
                    state = remember(dropoff) { MarkerState(LatLng(dropoff.latitude, dropoff.longitude)) },
                    icon = dropoffIcon,
                    anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.5f),
                    zIndex = 2f,
                )
            }
            if (rider != null && riderMarker != null) {
                val position = LatLng(rider.latitude, rider.longitude)
                val state = remember { MarkerState(position) }
                LaunchedEffect(position) { state.position = position }
                Marker(
                    state = state,
                    icon = riderMarker.icon,
                    anchor = riderMarker.anchor,
                    zIndex = 3f,
                )
            }
        }
        if (waitingForLocation) {
            Text(
                "Waiting for location",
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = statusTop + 12.dp)
                    .shadow(4.dp, RoundedCornerShape(12.dp))
                    .background(Color.White, RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                style = RidersType.small,
                color = RidersColors.textSecondary,
            )
        }
        }
    }
    LaunchedEffect(camera.isMoving, camera.cameraMoveStartedReason) {
        if (camera.isMoving && camera.cameraMoveStartedReason == CameraMoveStartedReason.GESTURE) {
            userMoved = true
        }
    }
}

private fun loosened(points: List<GeoPoint>): LatLngBounds {
    val bounds = LatLngBounds.builder().apply {
        points.forEach { include(LatLng(it.latitude, it.longitude)) }
    }.build()
    val latitudePad = (bounds.northeast.latitude - bounds.southwest.latitude) * FRAME_LOOSEN / 2.0
    val longitudePad = (bounds.northeast.longitude - bounds.southwest.longitude) * FRAME_LOOSEN / 2.0
    return LatLngBounds(
        LatLng(bounds.southwest.latitude - latitudePad, bounds.southwest.longitude - longitudePad),
        LatLng(bounds.northeast.latitude + latitudePad, bounds.northeast.longitude + longitudePad),
    )
}

@Composable
fun DeliveredDestinationMap(
    point: GeoPoint,
    address: String,
    sheetOverlap: Dp,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val mapStyles = remember(context) { RiderMapStyles.load(context) }
    val mapTheme = RiderMapThemeStore.read(context)
    val target = LatLng(point.latitude, point.longitude)
    val camera = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(target, 14f)
    }
    var mapLoaded by remember { mutableStateOf(false) }
    var userMoved by remember { mutableStateOf(false) }
    var icon by remember(address) { mutableStateOf<BitmapDescriptor?>(null) }
    var anchorY by remember(address) { mutableStateOf(1f) }
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val boundsPadding = collectionMarkerPaddingPx(12f, density.density)
    LaunchedEffect(context, address) {
        val marker = deliveredConfirmationIcon(context, address)
        icon = marker?.icon
        anchorY = marker?.anchorY ?: 1f
    }
    LaunchedEffect(mapLoaded, sheetOverlap, target, userMoved) {
        if (!mapLoaded || userMoved) {
            return@LaunchedEffect
        }
        runCatching {
            camera.animate(
                CameraUpdateFactory.newLatLngBounds(
                    loosened(withMinimumCameraSpan(listOf(point))),
                    boundsPadding,
                ),
                450,
            )
        }
    }
    Box(modifier) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            contentPadding = PaddingValues(
                start = 28.dp,
                top = statusTop + 132.dp,
                end = 28.dp,
                bottom = sheetOverlap + 24.dp,
            ),
            properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyles.optionsFor(mapTheme)),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                compassEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
                rotationGesturesEnabled = false,
                tiltGesturesEnabled = false,
            ),
            onMapLoaded = { mapLoaded = true },
        ) {
            if (icon != null) {
                Marker(
                    state = remember(target) { MarkerState(target) },
                    icon = icon,
                    anchor = androidx.compose.ui.geometry.Offset(0.5f, anchorY),
                    zIndex = 2f,
                )
            }
        }
    }
    LaunchedEffect(camera.isMoving, camera.cameraMoveStartedReason) {
        if (camera.isMoving && camera.cameraMoveStartedReason == CameraMoveStartedReason.GESTURE) {
            userMoved = true
        }
    }
}

private data class DeliveredMarker(val icon: BitmapDescriptor, val anchorY: Float)

private fun deliveredConfirmationIcon(context: android.content.Context, address: String): DeliveredMarker? {
    val density = context.resources.displayMetrics.density
    val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textSize = 14f * density
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    val placePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textSize = 13f * density
    }
    val place = fitMarkerText(address.trim(), placePaint, 200f * density)
    val padH = 12f * density
    val padV = 8f * density
    val gap = 3f * density
    val check = 14f * density
    val title = "Delivered"
    val titleWidth = titlePaint.measureText(title)
    val placeWidth = if (place.isEmpty()) 0f else placePaint.measureText(place)
    val boxWidth = (padH * 2 + maxOf(check + 6f * density + titleWidth, placeWidth)).toInt().coerceAtLeast(1)
    val titleHeight = titlePaint.fontMetrics.run { descent - ascent }
    val placeHeight = if (place.isEmpty()) 0f else placePaint.fontMetrics.run { descent - ascent }
    val rowHeight = maxOf(check, titleHeight)
    val boxHeight = (padV * 2 + rowHeight + if (place.isEmpty()) 0f else gap + placeHeight).toInt().coerceAtLeast(1)
    val pin = ContextCompat.getDrawable(context, R.drawable.ic_solid_dropoff_location)?.mutate()
    val pinWidth = (32f * density).toInt().coerceAtLeast(1)
    val pinHeight = (39f * density).toInt().coerceAtLeast(1)
    val pinGap = 5f * density
    val width = maxOf(boxWidth, pinWidth)
    val height = (boxHeight + pinGap + pinHeight).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val boxLeft = (width - boxWidth) / 2f
    canvas.drawRoundRect(
        boxLeft,
        0f,
        boxLeft + boxWidth,
        boxHeight.toFloat(),
        14f * density,
        14f * density,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF16845B.toInt() },
    )
    val checkTop = padV + (rowHeight - check) / 2f
    val contentLeft = boxLeft + padH
    canvas.drawPath(
        Path().apply {
            moveTo(contentLeft + check * 0.15f, checkTop + check * 0.52f)
            lineTo(contentLeft + check * 0.40f, checkTop + check * 0.78f)
            lineTo(contentLeft + check * 0.86f, checkTop + check * 0.24f)
        },
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 2f * density
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        },
    )
    canvas.drawText(
        title,
        contentLeft + check + 6f * density,
        padV + (rowHeight - titleHeight) / 2f - titlePaint.fontMetrics.ascent,
        titlePaint,
    )
    if (place.isNotEmpty()) {
        canvas.drawText(
            place,
            contentLeft,
            padV + rowHeight + gap - placePaint.fontMetrics.ascent,
            placePaint,
        )
    }
    pin?.setBounds(
        ((width - pinWidth) / 2f).toInt(),
        (boxHeight + pinGap).toInt(),
        ((width + pinWidth) / 2f).toInt(),
        (boxHeight + pinGap + pinHeight).toInt(),
    )
    pin?.draw(canvas)
    val tip = (boxHeight + pinGap + pinHeight * 55f / 58f) / height.toFloat()
    val descriptor = runCatching { BitmapDescriptorFactory.fromBitmap(bitmap) }.getOrNull() ?: return null
    return DeliveredMarker(descriptor, tip.coerceIn(0f, 1f))
}

private fun fitMarkerText(text: String, paint: Paint, maxWidth: Float): String {
    if (text.isEmpty() || paint.measureText(text) <= maxWidth) {
        return text
    }
    val ellipsis = "…"
    var end = text.length
    while (end > 1 && paint.measureText(text.substring(0, end).trimEnd() + ellipsis) > maxWidth) {
        end -= 1
    }
    return text.substring(0, end).trimEnd() + ellipsis
}

private fun locationDrawableMarker(context: android.content.Context, drawableId: Int): BitmapDescriptor? {
    val drawable = ContextCompat.getDrawable(context, drawableId)?.mutate() ?: return null
    val density = context.resources.displayMetrics.density
    val width = (32f * density).toInt().coerceAtLeast(1)
    val height = (39f * density).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, width, height)
    drawable.draw(Canvas(bitmap))
    return runCatching { BitmapDescriptorFactory.fromBitmap(bitmap) }.getOrNull()
}
