package com.riders.rider.feature.offers.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
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
import com.riders.rider.feature.delivery.domain.ARRIVAL_METRES
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.haversineMetres
import com.riders.rider.feature.delivery.domain.cameraHeading
import com.riders.rider.feature.delivery.domain.reliableBearing
import com.riders.rider.feature.delivery.domain.retainedHeading
import com.riders.rider.feature.delivery.presentation.animateHeadingUp
import com.riders.rider.feature.delivery.presentation.showFittedCamera
import com.riders.rider.feature.delivery.domain.withMinimumCameraSpan
import com.riders.rider.feature.delivery.domain.SAME_PLACE_METRES
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.requestCameraInsets
import com.riders.rider.feature.delivery.domain.MarkerCameraGate
import com.riders.rider.feature.delivery.domain.MarkerCameraPhase
import com.riders.rider.feature.delivery.domain.markerStaysAttached
import com.riders.rider.feature.delivery.domain.deliveryWhenLabel
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.presentation.pickupPinColor
import com.riders.rider.feature.delivery.presentation.dropoffPinColor
import com.riders.rider.feature.delivery.presentation.RiderMapStyles
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.feature.delivery.presentation.RiderMapThemeStore
import com.riders.rider.feature.delivery.presentation.StableRiderMarkers
import com.riders.rider.feature.delivery.presentation.approachTagIcon
import com.riders.rider.feature.delivery.presentation.riderMotorcycleDescriptor
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Reusable Google Maps route view for bids and other rider screens.
// Pin shapes use the same drawable assets as the delivery cards.
private const val DELIVERED_FRAME_LOOSEN = 0.08

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
    riderSpeedMetresPerSecond: Float? = null,
    riderBearingDegrees: Float? = null,
    riderBearingAccuracyDegrees: Float? = null,
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
    var fittedZoom by remember(deliveryId) { mutableStateOf<Float?>(null) }
    var travelHeading by remember(deliveryId) { mutableStateOf<Float?>(null) }
    val bearingReading = reliableBearing(
        riderSpeedMetresPerSecond,
        riderBearingDegrees,
        riderBearingAccuracyDegrees,
    )
    val travel = retainedHeading(travelHeading, bearingReading)
    if (travel != travelHeading) {
        travelHeading = travel
    }
    val heading = cameraHeading(
        travel,
        if (line.size > 1) line else emptyList(),
        rider,
        dropoff,
    )
    val headingNow = rememberUpdatedState(heading)
    val cameraLock = remember(deliveryId) { Mutex() }
    val markerGate = remember(deliveryId) { MarkerCameraGate() }
    var markerPhase by remember(deliveryId) { mutableStateOf(MarkerCameraPhase()) }
    var pickupAttached by remember(deliveryId) { mutableStateOf(false) }
    var dropoffAttached by remember(deliveryId) { mutableStateOf(false) }
    var heldRider by remember(deliveryId) { mutableStateOf<LatLng?>(null) }
    val liveRider = rider?.let { LatLng(it.latitude, it.longitude) }
    if (liveRider != null && liveRider != heldRider) {
        heldRider = liveRider
    }
    val riderGate = rider != null || framedRider
    val road = line.filter { it.latitude.isFinite() && it.longitude.isFinite() }
    val routeReady = road.size > 1
    val routeGate = routeReady || framedRoute
    val layoutWidth = if (mapWidth > 0) mapWidth else 10_000
    val layoutHeight = if (mapHeight > 0) mapHeight else 10_000
    val cameraInsets = requestCameraInsets(
        mapWidthPx = layoutWidth,
        mapHeightPx = layoutHeight,
        density = density.density,
        statusTopPx = WindowInsets.statusBars.getTop(density),
        sheetOverlapPx = with(density) { sheetOverlap.roundToPx() },
        includeRider = rider != null,
    )
    val stroke = with(density) { routeWidth.toPx() }
    val motorcycleIcon = remember(mapLoaded) {
        if (mapLoaded) riderMotorcycleDescriptor(context) else null
    }
    val tagIcon = remember(approachLabel, mapLoaded) {
        val label = approachLabel
        if (mapLoaded && !label.isNullOrBlank()) approachTagIcon(context, label) else null
    }
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }

    LaunchedEffect(deliveryId, pickup, dropoff, routeGate, riderGate, mapLoaded, mapWidth, mapHeight, recenter, sheetOverlap) {
        val centering = recenter != seenRecenter
        if (!mapLoaded || mapWidth <= 0 || mapHeight <= 0 || sheetOverlap <= 0.dp) {
            return@LaunchedEffect
        }
        if (userMoved && !centering) {
            markerPhase = markerGate.settleWithoutAnimation()
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
        val framed = ArrayList<GeoPoint>(road.size + 3)
        if (routeReady) {
            framed.addAll(road)
        }
        if (pickup != null) {
            framed.add(pickup)
        }
        if (dropoff != null) {
            framed.add(dropoff)
        }
        if (rider != null) {
            framed.add(rider)
        }
        val frame = collectionCameraFrame(
            rider ?: dropoff,
            if (rider != null) dropoff else pickup,
            framed,
        )
        markerPhase = markerGate.begin()
        try {
            if (frame == null) {
                return@LaunchedEffect
            }
            val update = CameraUpdateFactory.newLatLngBounds(
                loosened(withMinimumCameraSpan(frame.points, SAME_PLACE_METRES), 0.0),
                0,
            )
            cameraLock.withLock {
                runCatching {
                    fittedZoom = showFittedCamera(
                        camera,
                        update,
                        if (rider != null) headingNow.value else null,
                    )
                }
            }
        } finally {
            markerPhase = markerGate.end()
        }
    }

    LaunchedEffect(heading, userMoved, mapLoaded, rider != null, fittedZoom) {
        val zoom = fittedZoom ?: return@LaunchedEffect
        if (!mapLoaded) {
            return@LaunchedEffect
        }
        if (userMoved) {
            markerPhase = markerGate.settleWithoutAnimation()
            return@LaunchedEffect
        }
        val target = heading
        if (rider == null || target == null) {
            return@LaunchedEffect
        }
        markerPhase = markerGate.begin()
        try {
            cameraLock.withLock {
                if (!userMoved) {
                    animateHeadingUp(camera, target, zoom)
                }
            }
        } finally {
            markerPhase = markerGate.end()
        }
    }

    val nextPickup = markerStaysAttached(pickupAttached, markerPhase.acceptingNew, pickup != null && pickupIcon != null)
    if (nextPickup != pickupAttached) {
        pickupAttached = nextPickup
    }
    val nextDropoff = markerStaysAttached(dropoffAttached, markerPhase.acceptingNew, dropoff != null && dropoffIcon != null)
    if (nextDropoff != dropoffAttached) {
        dropoffAttached = nextDropoff
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
                start = with(density) { cameraInsets.startPx.toDp() },
                top = with(density) { cameraInsets.topPx.toDp() },
                end = with(density) { cameraInsets.endPx.toDp() },
                bottom = with(density) { cameraInsets.bottomPx.toDp() },
            ),
            properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyles.optionsFor(mapTheme, LocalAppDark.current)),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                compassEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
                rotationGesturesEnabled = rider != null,
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
            val atDropoff = rider != null && dropoff != null &&
                haversineMetres(rider, dropoff) <= ARRIVAL_METRES.toInt()
            if (road.size > 1 && !atDropoff) {
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
            if (pickupAttached && pickup != null && pickupIcon != null) {
                Marker(
                    state = remember(pickup) { MarkerState(LatLng(pickup.latitude, pickup.longitude)) },
                    icon = pickupIcon,
                    anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.5f),
                    zIndex = 1f,
                )
            }
            if (dropoffAttached && dropoff != null && dropoffIcon != null) {
                Marker(
                    state = remember(dropoff) { MarkerState(LatLng(dropoff.latitude, dropoff.longitude)) },
                    icon = dropoffIcon,
                    anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.5f),
                    zIndex = 2f,
                )
            }
            StableRiderMarkers(
                identity = deliveryId,
                position = heldRider,
                motorcycle = motorcycleIcon,
                tag = tagIcon,
                zIndex = 3f,
            )
        }
        if (waitingForLocation) {
            Text(
                "Waiting for location",
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = statusTop + 12.dp)
                    .shadow(4.dp, RoundedCornerShape(12.dp))
                    .background(RidersColors.sheet, RoundedCornerShape(12.dp))
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

private fun loosened(points: List<GeoPoint>, loosen: Double): LatLngBounds {
    val bounds = LatLngBounds.builder().apply {
        points.forEach { include(LatLng(it.latitude, it.longitude)) }
    }.build()
    val latitudePad = (bounds.northeast.latitude - bounds.southwest.latitude) * loosen / 2.0
    val longitudePad = (bounds.northeast.longitude - bounds.southwest.longitude) * loosen / 2.0
    return LatLngBounds(
        LatLng(bounds.southwest.latitude - latitudePad, bounds.southwest.longitude - longitudePad),
        LatLng(bounds.northeast.latitude + latitudePad, bounds.northeast.longitude + longitudePad),
    )
}

@Composable
fun DeliveredDestinationMap(
    point: GeoPoint,
    recipient: String,
    address: String,
    completedAt: String?,
    sheetOverlap: Dp,
    modifier: Modifier = Modifier,
    recenter: Int = 0,
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
    var mapHeightPx by remember { mutableIntStateOf(0) }
    var userMoved by remember { mutableStateOf(false) }
    var seenRecenter by remember { mutableIntStateOf(recenter) }
    var icon by remember(recipient, address, completedAt) { mutableStateOf<BitmapDescriptor?>(null) }
    var anchorY by remember(recipient, address, completedAt) { mutableStateOf(1f) }
    var markerHeightPx by remember(recipient, address, completedAt) { mutableIntStateOf(0) }
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val boundsPadding = collectionMarkerPaddingPx(12f, density.density)
    val bottomPad = sheetOverlap + 24.dp
    val backClearance = statusTop + 56.dp
    val markerHeight = with(density) { markerHeightPx.toDp() }
    val mapHeight = with(density) { mapHeightPx.toDp() }
    val maxTop = if (mapHeightPx > 0) {
        (mapHeight - bottomPad - 96.dp).coerceAtLeast(backClearance)
    } else {
        backClearance
    }
    val topPad = if (markerHeightPx > 0) {
        markerHeight.coerceIn(backClearance, maxTop)
    } else {
        backClearance.coerceAtMost(maxTop)
    }
    LaunchedEffect(mapLoaded, mapHeightPx, sheetOverlap, context, recipient, address, completedAt) {
        if (!mapLoaded || mapHeightPx <= 0) {
            return@LaunchedEffect
        }
        val bottomPx = with(density) { bottomPad.roundToPx() }
        val minViewportPx = with(density) { 96.dp.roundToPx() }
        val limit = (mapHeightPx - bottomPx - minViewportPx).coerceAtLeast(with(density) { 120.dp.roundToPx() })
        val marker = deliveredConfirmationIcon(context, recipient, address, completedAt, limit)
        icon = marker?.icon
        anchorY = marker?.anchorY ?: 1f
        markerHeightPx = marker?.heightPx ?: 0
    }
    LaunchedEffect(mapLoaded, sheetOverlap, markerHeightPx, target, userMoved, recenter) {
        val centering = recenter != seenRecenter
        if (centering) {
            seenRecenter = recenter
            userMoved = false
        }
        if (!mapLoaded || (userMoved && !centering)) {
            return@LaunchedEffect
        }
        runCatching {
            camera.animate(
                CameraUpdateFactory.newLatLngBounds(
                    loosened(withMinimumCameraSpan(listOf(point)), DELIVERED_FRAME_LOOSEN),
                    boundsPadding,
                ),
                450,
            )
        }
    }
    Box(modifier) {
        GoogleMap(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { mapHeightPx = it.height },
            cameraPositionState = camera,
            contentPadding = PaddingValues(
                start = 28.dp,
                top = topPad,
                end = 28.dp,
                bottom = bottomPad,
            ),
            properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyles.optionsFor(mapTheme, LocalAppDark.current)),
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

private data class DeliveredMarker(val icon: BitmapDescriptor, val anchorY: Float, val heightPx: Int)

private fun deliveredConfirmationIcon(
    context: android.content.Context,
    recipient: String,
    address: String,
    completedAt: String?,
    maxHeightPx: Int,
): DeliveredMarker? {
    val density = context.resources.displayMetrics.density
    val maxText = (268f * density).toInt().coerceAtLeast(1)
    val titlePaint = markerTextPaint(17f * density, Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
    val namePaint = markerTextPaint(17f * density, Typeface.create("sans-serif-medium", Typeface.NORMAL))
    val placePaint = markerTextPaint(16f * density, Typeface.create(Typeface.DEFAULT, Typeface.NORMAL))
    val timePaint = markerTextPaint(16f * density, Typeface.create(Typeface.DEFAULT, Typeface.NORMAL))
    val name = recipient.trim()
    val place = address.trim()
    val time = deliveryWhenLabel(completedAt)
    val nameLayout = if (name.isEmpty()) null else wrappedMarkerText(name, namePaint, maxText)
    val placeLayout = if (place.isEmpty()) null else wrappedMarkerText(place, placePaint, maxText)
    val padH = 16f * density
    val padV = 12f * density
    val gap = 5f * density
    val circle = 20f * density
    val check = 12f * density
    val title = "Delivered"
    val titleWidth = titlePaint.measureText(title)
    val titleRow = circle + 6f * density + titleWidth
    val timeWidth = if (time.isEmpty()) 0f else timePaint.measureText(time)
    val contentWidth = maxOf(titleRow, nameLayout.widestLine(), placeLayout.widestLine(), timeWidth)
    val boxWidth = (padH * 2 + contentWidth).toInt().coerceAtLeast(1)
    val titleHeight = titlePaint.fontMetrics.run { descent - ascent }
    val rowHeight = maxOf(circle, titleHeight)
    val timeTextHeight = if (time.isEmpty()) 0f else timePaint.fontMetrics.run { descent - ascent }
    val timeRow = if (time.isEmpty()) 0f else timeTextHeight
    var textHeight = rowHeight
    if (nameLayout != null) textHeight += gap + nameLayout.height
    if (placeLayout != null) textHeight += gap + placeLayout.height
    if (time.isNotEmpty()) textHeight += gap + timeRow
    val boxHeight = (padV * 2 + textHeight).toInt().coerceAtLeast(1)
    val pin = ContextCompat.getDrawable(context, R.drawable.ic_solid_dropoff_location)?.mutate()
    val pinWidth = (32f * density).toInt().coerceAtLeast(1)
    val pinHeight = (39f * density).toInt().coerceAtLeast(1)
    val pinGap = 5f * density
    val width = maxOf(boxWidth, pinWidth)
    val height = (boxHeight + pinGap + pinHeight).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val boxLeft = (width - boxWidth) / 2f
    val shadow = 3f * density
    canvas.drawRoundRect(
        boxLeft,
        shadow,
        boxLeft + boxWidth,
        shadow + boxHeight,
        18f * density,
        18f * density,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x3317211D },
    )
    canvas.drawRoundRect(
        boxLeft,
        0f,
        boxLeft + boxWidth,
        boxHeight.toFloat(),
        18f * density,
        18f * density,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF16845B.toInt() },
    )
    val contentLeft = boxLeft + padH
    val circleTop = padV + (rowHeight - circle) / 2f
    canvas.drawCircle(
        contentLeft + circle / 2f,
        circleTop + circle / 2f,
        circle / 2f,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE },
    )
    val checkLeft = contentLeft + (circle - check) / 2f
    val checkTop = circleTop + (circle - check) / 2f
    canvas.drawPath(
        Path().apply {
            moveTo(checkLeft + check * 0.15f, checkTop + check * 0.52f)
            lineTo(checkLeft + check * 0.40f, checkTop + check * 0.78f)
            lineTo(checkLeft + check * 0.86f, checkTop + check * 0.24f)
        },
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF16845B.toInt()
            style = Paint.Style.STROKE
            strokeWidth = 2f * density
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        },
    )
    canvas.drawText(
        title,
        contentLeft + circle + 6f * density,
        padV + (rowHeight - titleHeight) / 2f - titlePaint.fontMetrics.ascent,
        titlePaint,
    )
    var cursor = padV + rowHeight
    if (nameLayout != null) {
        cursor += gap
        canvas.save()
        canvas.translate(contentLeft, cursor)
        nameLayout.draw(canvas)
        canvas.restore()
        cursor += nameLayout.height
    }
    if (placeLayout != null) {
        cursor += gap
        canvas.save()
        canvas.translate(contentLeft, cursor)
        placeLayout.draw(canvas)
        canvas.restore()
        cursor += placeLayout.height
    }
    if (time.isNotEmpty()) {
        cursor += gap
        canvas.drawText(
            time,
            contentLeft,
            cursor - timePaint.fontMetrics.ascent,
            timePaint,
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
    val longest = maxOf(bitmap.width, bitmap.height)
    val heightLimit = if (maxHeightPx > 0) minOf(bitmap.height, maxHeightPx) else bitmap.height
    val scale = minOf(1f, heightLimit.toFloat() / bitmap.height, if (longest > 1024) 1024f / longest else 1f)
    val rendered = if (scale < 1f) {
        Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).toInt().coerceAtLeast(1),
            (bitmap.height * scale).toInt().coerceAtLeast(1),
            true,
        )
    } else {
        bitmap
    }
    val descriptor = runCatching { BitmapDescriptorFactory.fromBitmap(rendered) }.getOrNull() ?: return null
    return DeliveredMarker(descriptor, tip.coerceIn(0f, 1f), rendered.height)
}

private fun markerTextPaint(textSize: Float, typeface: Typeface): TextPaint {
    return TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        this.textSize = textSize
        this.typeface = typeface
    }
}

private fun wrappedMarkerText(text: String, paint: TextPaint, width: Int): StaticLayout {
    return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setIncludePad(false)
        .build()
}

private fun StaticLayout?.widestLine(): Float {
    if (this == null || lineCount == 0) {
        return 0f
    }
    var widest = 0f
    for (line in 0 until lineCount) {
        widest = maxOf(widest, getLineWidth(line))
    }
    return widest
}

internal fun locationDrawableMarker(context: android.content.Context, drawableId: Int): BitmapDescriptor? {
    val drawable = ContextCompat.getDrawable(context, drawableId)?.mutate() ?: return null
    val density = context.resources.displayMetrics.density
    val width = (32f * density).toInt().coerceAtLeast(1)
    val height = (39f * density).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, width, height)
    drawable.draw(Canvas(bitmap))
    return runCatching { BitmapDescriptorFactory.fromBitmap(bitmap) }.getOrNull()
}
