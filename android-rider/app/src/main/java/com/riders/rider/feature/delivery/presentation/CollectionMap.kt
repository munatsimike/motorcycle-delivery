package com.riders.rider.feature.delivery.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.RoundCap
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.riders.rider.R
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.ARRIVAL_METRES
import com.riders.rider.feature.delivery.domain.haversineMetres
import com.riders.rider.feature.delivery.domain.pickupTagLabel
import com.riders.rider.feature.delivery.domain.PICKUP_ARRIVED_TAG
import com.riders.rider.feature.delivery.domain.cameraHeading
import com.riders.rider.feature.delivery.domain.reliableBearing
import com.riders.rider.feature.delivery.domain.retainedHeading
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.MarkerCameraGate
import com.riders.rider.feature.delivery.domain.MarkerCameraPhase
import com.riders.rider.feature.delivery.domain.markerStaysAttached
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.domain.ROUTE_MIN_FRAME_SPAN_METRES
import com.riders.rider.feature.delivery.domain.withMinimumCameraSpan
import com.riders.rider.feature.offers.presentation.locationDrawableMarker
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private val routeBlue = Color(0xFF1A73E8)
private val sideClearance = 40.dp
private val horizontalPadding = 32.dp
private val pinClearance = 48.dp
private val boundsAir = 12.dp
/** Shows about 4% more ground than a tight fit, at every distance. */
private const val FRAME_LOOSEN = 0.04
/** Circular back control: 12.dp under the status bar, 44.dp tall, plus an 8.dp gap. */
private val mapChromeClearance = 64.dp

@Composable
fun CollectionMap(
    assignmentId: String,
    pickupLatitude: String?,
    pickupLongitude: String?,
    sheetOverlap: Dp,
    modifier: Modifier = Modifier,
    model: CollectionMapModel = hiltViewModel(),
) {
    val pickup = remember(pickupLatitude, pickupLongitude) { parseGeoPoint(pickupLatitude, pickupLongitude) }
    val rider by model.rider.collectAsStateWithLifecycle()
    val route by model.route.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val density = LocalDensity.current
    val mapStyles = remember(context) { RiderMapStyles.load(context) }
    val mapStyle = mapStyles.optionsFor(RiderMapTheme.ClassicLight, LocalAppDark.current)
    var pickupIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    val initial = pickup ?: rider?.let { GeoPoint(it.latitude, it.longitude) }
    val camera = rememberCameraPositionState {
        if (initial != null) {
            position = CameraPosition.fromLatLngZoom(initial.toLatLng(), 14f)
        }
    }
    var mapLoaded by remember { mutableStateOf(false) }
    var mapWidth by remember { mutableStateOf(0) }
    var mapHeight by remember { mutableStateOf(0) }
    var userMoved by remember(assignmentId) { mutableStateOf(false) }
    var framedWithRider by remember(assignmentId, pickup) { mutableStateOf(false) }
    var framedRoute by remember(assignmentId, pickup) { mutableStateOf(false) }
    var recenter by remember { mutableStateOf(0) }
    var travelHeading by remember(assignmentId) { mutableStateOf<Float?>(null) }
    val bearingReading = reliableBearing(
        rider?.speedMetresPerSecond,
        rider?.bearingDegrees,
        rider?.bearingAccuracyDegrees,
    )
    val travel = retainedHeading(travelHeading, bearingReading)
    if (travel != travelHeading) {
        travelHeading = travel
    }
    val heading = cameraHeading(
        travel,
        if (route.line.size > 1) route.line else emptyList(),
        rider?.let { GeoPoint(it.latitude, it.longitude) },
        pickup,
    )
    val headingNow = rememberUpdatedState(heading)
    val cameraLock = remember(assignmentId) { Mutex() }
    val markerGate = remember(assignmentId) { MarkerCameraGate() }
    var markerPhase by remember(assignmentId) { mutableStateOf(MarkerCameraPhase()) }
    var pickupAttached by remember(assignmentId) { mutableStateOf(false) }
    var heldRider by remember(assignmentId) { mutableStateOf<LatLng?>(null) }
    val riderPoint = rider?.let { GeoPoint(it.latitude, it.longitude) }
    val liveRider = riderPoint?.toLatLng()
    if (liveRider != null && liveRider != heldRider) {
        heldRider = liveRider
    }
    val riderReady = riderPoint != null
    val riderGate = riderReady || framedWithRider
    val routeReady = route.line.size > 1
    val routeGate = routeReady || framedRoute
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val approachLabel = pickupTagLabel(riderPoint, pickup, route.metres, route.seconds)
    val motorcycleIcon = remember(mapLoaded) {
        if (mapLoaded) riderMotorcycleDescriptor(context) else null
    }
    val tagIcon = remember(approachLabel, mapLoaded) {
        val label = approachLabel
        if (mapLoaded && !label.isNullOrBlank()) approachTagIcon(context, label) else null
    }
    val topClearance = statusTop + mapChromeClearance + pinClearance
    val mapHeightDp = with(density) { mapHeight.toDp() }
    val paddingBudget = if (mapHeightDp > 96.dp) (mapHeightDp - 96.dp) / 2 else 0.dp
    val topPadding = if (mapHeightDp > 96.dp) topClearance.coerceAtMost(paddingBudget) else 0.dp
    val bottomPadding = if (mapHeightDp > 96.dp) (sheetOverlap + sideClearance).coerceAtMost(paddingBudget) else 0.dp
    val boundsPadding = collectionMarkerPaddingPx(boundsAir.value, density.density)
    val stroke = with(density) { 4.dp.toPx() }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, assignmentId, pickup) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> if (assignmentId.isNotBlank() && pickup != null) {
                    model.activate(CollectionTarget(assignmentId, pickup))
                }
                Lifecycle.Event.ON_STOP -> model.deactivate()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            model.deactivate()
        }
    }

    LaunchedEffect(assignmentId, pickup, riderGate, routeGate, mapLoaded, mapWidth, mapHeight, recenter, sheetOverlap) {
        if (!mapLoaded || mapWidth <= 0 || mapHeight <= 0) {
            return@LaunchedEffect
        }
        if (userMoved) {
            markerPhase = markerGate.settleWithoutAnimation()
            return@LaunchedEffect
        }
        if (riderReady) {
            framedWithRider = true
        }
        if (routeReady) {
            framedRoute = true
        }
        val frame = collectionCameraFrame(
            riderPoint,
            pickup,
            if (routeReady) route.line else emptyList(),
        )
        markerPhase = markerGate.begin()
        try {
            if (frame == null) {
                return@LaunchedEffect
            }
            val update = CameraUpdateFactory.newLatLngBounds(
                loosenedBounds(withMinimumCameraSpan(frame.points, ROUTE_MIN_FRAME_SPAN_METRES)),
                boundsPadding,
            )
            cameraLock.withLock {
                runCatching { showFittedCamera(camera, update, if (riderPoint != null) headingNow.value else null) }
            }
        } finally {
            markerPhase = markerGate.end()
        }
    }

    LaunchedEffect(heading, userMoved, mapLoaded) {
        if (!mapLoaded) {
            return@LaunchedEffect
        }
        if (userMoved) {
            markerPhase = markerGate.settleWithoutAnimation()
            return@LaunchedEffect
        }
        val target = heading ?: return@LaunchedEffect
        markerPhase = markerGate.begin()
        try {
            cameraLock.withLock {
                if (!userMoved) {
                    animateHeadingUp(camera, target)
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
    Box(modifier) {
        if (initial != null) {
            GoogleMap(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged {
                        mapWidth = it.width
                        mapHeight = it.height
                    },
                cameraPositionState = camera,
                contentPadding = PaddingValues(
                    start = horizontalPadding,
                    top = topPadding,
                    end = horizontalPadding,
                    bottom = bottomPadding,
                ),
                properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyle),
                uiSettings = MapUiSettings(
                    zoomControlsEnabled = false,
                    compassEnabled = false,
                    myLocationButtonEnabled = false,
                    mapToolbarEnabled = false,
                    rotationGesturesEnabled = true,
                    tiltGesturesEnabled = false,
                ),
                onMapLoaded = {
                    mapLoaded = true
                    if (pickupIcon == null) {
                        pickupIcon = locationDrawableMarker(context, R.drawable.ic_solid_pickup_location)
                    }
                },
            ) {
                val atStop = riderPoint != null && pickup != null &&
                    haversineMetres(riderPoint, pickup) <= ARRIVAL_METRES.toInt()
                if (route.line.size > 1 && !atStop) {
                    Polyline(
                        points = route.line.map { it.toLatLng() },
                        color = routeBlue,
                        width = stroke,
                        jointType = JointType.ROUND,
                        startCap = RoundCap(),
                        endCap = RoundCap(),
                        zIndex = 0f,
                    )
                }
                if (pickupAttached && pickup != null && pickupIcon != null) {
                    Marker(
                        state = remember(pickup) { MarkerState(pickup.toLatLng()) },
                        icon = pickupIcon,
                        anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.92f),
                        zIndex = 1f,
                    )
                }
                StableRiderMarkers(
                    identity = assignmentId,
                    position = heldRider,
                    motorcycle = motorcycleIcon,
                    tag = tagIcon,
                    zIndex = 2f,
                )
            }
        }
        if (pickup != null && rider == null) {
            Text(
                "Location unavailable",
                style = RidersType.captionStrong,
                color = RidersColors.textSecondary,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = RidersSpacing.lg)
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .clip(CircleShape)
                    .background(RidersColors.sheet)
                    .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
            )
        }
        Icon(
            painter = painterResource(R.drawable.ic_recenter),
            contentDescription = "Recenter map",
            tint = RidersColors.text,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = RidersSpacing.md, bottom = sheetOverlap + RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button) {
                    userMoved = false
                    recenter += 1
                }
                .padding(10.dp),
        )
    }

    LaunchedEffect(camera.isMoving, camera.cameraMoveStartedReason) {
        if (camera.isMoving && camera.cameraMoveStartedReason == com.google.maps.android.compose.CameraMoveStartedReason.GESTURE) {
            userMoved = true
        }
    }
}

private fun GeoPoint.toLatLng(): LatLng = LatLng(latitude, longitude)

/** Grows the fitted area evenly around its center so the camera zooms out without sliding. */
private fun loosenedBounds(points: List<GeoPoint>): LatLngBounds {
    val bounds = LatLngBounds.builder().apply {
        points.forEach { include(it.toLatLng()) }
    }.build()
    val latitudePad = (bounds.northeast.latitude - bounds.southwest.latitude) * FRAME_LOOSEN / 2.0
    val longitudePad = (bounds.northeast.longitude - bounds.southwest.longitude) * FRAME_LOOSEN / 2.0
    return LatLngBounds(
        LatLng(bounds.southwest.latitude - latitudePad, bounds.southwest.longitude - longitudePad),
        LatLng(bounds.northeast.latitude + latitudePad, bounds.northeast.longitude + longitudePad),
    )
}

/** Distance label. The bitmap is anchored on the motorcycle center, 8dp above the artwork. */
internal data class RiderMarkerIcon(val icon: BitmapDescriptor, val anchor: Offset)

/**
 * Motorcycle and distance tag stay mounted for the life of [identity].
 * A later fix only moves the existing marker states. Camera work does not remove them.
 */
@Composable
internal fun StableRiderMarkers(
    identity: String,
    position: LatLng?,
    motorcycle: BitmapDescriptor?,
    tag: RiderMarkerIcon?,
    zIndex: Float,
) {
    if (position == null || motorcycle == null) {
        return
    }
    val bikeState = remember(identity) { MarkerState(position) }
    val tagState = remember(identity) { MarkerState(position) }
    LaunchedEffect(position.latitude, position.longitude) {
        val next = LatLng(position.latitude, position.longitude)
        bikeState.position = next
        tagState.position = next
    }
    Marker(
        state = bikeState,
        icon = motorcycle,
        anchor = Offset(0.5f, 0.5f),
        rotation = 0f,
        flat = false,
        zIndex = zIndex,
    )
    if (tag != null) {
        Marker(
            state = tagState,
            icon = tag.icon,
            anchor = tag.anchor,
            rotation = 0f,
            flat = false,
            zIndex = zIndex + 1f,
        )
    }
}

internal fun riderMotorcycleDescriptor(context: android.content.Context): BitmapDescriptor {
    return BitmapDescriptorFactory.fromBitmap(riderMotorcycleImage(context))
}

internal const val TAG_TIP_WIDTH_DP = 12f
internal const val TAG_TIP_HEIGHT_DP = 6f
internal const val TAG_VISIBLE_GAP_DP = 6f

/** Space from the motorcycle centre up to the tag tip, after the image's transparent top. */
internal fun tagSpaceBelowTipDp(markerDp: Float, topInsetFraction: Float): Float {
    val insetDp = topInsetFraction.coerceIn(0f, 1f) * markerDp
    val visibleAboveCenter = (markerDp / 2f - insetDp).coerceAtLeast(0f)
    return visibleAboveCenter + TAG_VISIBLE_GAP_DP
}

/** Distance pill. Arrived uses solid primary green and white text. The tip sits 6dp above the visible motorcycle. */
internal fun approachTagIcon(context: android.content.Context, label: String): RiderMarkerIcon {
    val arrived = label == PICKUP_ARRIVED_TAG
    val density = context.resources.displayMetrics.density
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = if (arrived) android.graphics.Color.WHITE else 0xFF17211D.toInt()
        textSize = 14f * density
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    val padH = 12f * density
    val padV = 6f * density
    val textWidth = textPaint.measureText(label)
    val textHeight = textPaint.fontMetrics.run { descent - ascent }
    val badgeWidth = textWidth + padH * 2f
    val badgeHeight = textHeight + padV * 2f
    val tipWidth = TAG_TIP_WIDTH_DP * density
    val tipHeight = TAG_TIP_HEIGHT_DP * density
    val belowTip = tagSpaceBelowTipDp(RIDER_MOTORCYCLE_MARKER_DP, motorcycleTopInsetFraction(context)) * density
    val shadow = 3f * density
    val width = (badgeWidth + shadow * 2f).toInt().coerceAtLeast(1)
    val height = (badgeHeight + tipHeight + belowTip).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val badgeLeft = (width - badgeWidth) / 2f
    val radius = badgeHeight / 2f
    val fill = if (arrived) 0xFF169B62.toInt() else android.graphics.Color.WHITE
    val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x3317211D }
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill }
    val tip = tagTip(width / 2f, badgeHeight, tipWidth, tipHeight)
    val shadowTip = tagTip(width / 2f, badgeHeight + shadow, tipWidth, tipHeight)
    canvas.drawRoundRect(
        badgeLeft,
        shadow,
        badgeLeft + badgeWidth,
        shadow + badgeHeight,
        radius,
        radius,
        shadowPaint,
    )
    canvas.drawPath(shadowTip, shadowPaint)
    canvas.drawRoundRect(
        badgeLeft,
        0f,
        badgeLeft + badgeWidth,
        badgeHeight,
        radius,
        radius,
        fillPaint,
    )
    canvas.drawPath(tip, fillPaint)
    canvas.drawText(
        label,
        badgeLeft + padH,
        padV - textPaint.fontMetrics.ascent,
        textPaint,
    )
    return RiderMarkerIcon(BitmapDescriptorFactory.fromBitmap(bitmap), Offset(0.5f, 1f))
}

private fun tagTip(centerX: Float, badgeBottom: Float, tipWidth: Float, tipHeight: Float): Path {
    return Path().apply {
        moveTo(centerX - tipWidth / 2f, badgeBottom)
        lineTo(centerX + tipWidth / 2f, badgeBottom)
        lineTo(centerX, badgeBottom + tipHeight)
        close()
    }
}

/** Original marker was 90dp. Current size is 72dp reduced by a further 10%. */
internal const val RIDER_MOTORCYCLE_MARKER_DP = 64.8f

/** Cache only the final, small marker bitmap; no Activity or Context is retained. */
private data class CachedMotorcycleMarker(
    val size: Int,
    val bitmap: Bitmap,
    val topInsetFraction: Float,
)

private var cachedMotorcycleMarker: CachedMotorcycleMarker? = null

@Synchronized
private fun cachedMotorcycleMarker(context: android.content.Context): CachedMotorcycleMarker {
    val size = (RIDER_MOTORCYCLE_MARKER_DP * context.resources.displayMetrics.density).toInt().coerceAtLeast(1)
    cachedMotorcycleMarker?.takeIf { it.size == size }?.let { return it }
    val source = android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.rider_motorcycle_yellow_box)
    // Keep the existing square display dimensions and orientation.
    val bitmap = Bitmap.createScaledBitmap(source, size, size, true)
    if (source !== bitmap) source.recycle()
    // Do not recycle a previous cached bitmap: a visible map may still hold it.
    return CachedMotorcycleMarker(size, bitmap, motorcycleTopInsetFraction(bitmap)).also {
        cachedMotorcycleMarker = it
    }
}

/** Unrotated artwork for turn-by-turn, which rotates the marker itself. */
internal fun riderMotorcycleImage(context: android.content.Context): Bitmap = cachedMotorcycleMarker(context).bitmap

/** Fraction of transparent space above the artwork, calculated once per marker size. */
internal fun motorcycleTopInsetFraction(context: android.content.Context): Float = cachedMotorcycleMarker(context).topInsetFraction

internal fun motorcycleTopInsetFraction(bitmap: Bitmap): Float {
    val height = bitmap.height
    val width = bitmap.width
    if (height <= 0 || width <= 0) {
        return 0f
    }
    val pixels = IntArray(width)
    for (y in 0 until height) {
        bitmap.getPixels(pixels, 0, width, 0, y, width, 1)
        for (pixel in pixels) {
            if (pixel ushr 24 > 16) {
                return y.toFloat() / height.toFloat()
            }
        }
    }
    return 0f
}

internal fun riderMotorcycleBitmap(context: android.content.Context): BitmapDescriptor {
    val image = riderMotorcycleImage(context)
    return BitmapDescriptorFactory.fromBitmap(image)
}
