package com.riders.rider.feature.offers.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
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
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.offers.domain.OfferActionProgress
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.presentation.RiderMapStyles
import com.riders.rider.feature.delivery.presentation.RiderMapThemeStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job

private val pickupGreen = Color(0xFF169B62)
private val dropoffBlue = Color(0xFF1A73E8)
private const val FRAME_LOOSEN = 0.08

@HiltViewModel
class RequestRouteModel @Inject constructor(
    private val bids: BidRepository,
) : ViewModel() {
    var line by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    private data class RouteKey(val deliveryId: String, val pickup: GeoPoint?, val dropoff: GeoPoint?)
    private var requested: RouteKey? = null
    private var job: Job? = null
    private val cache = LinkedHashMap<RouteKey, List<GeoPoint>>(16, 0.75f, true)

    fun cancelPending(deliveryId: String, pickup: GeoPoint?, dropoff: GeoPoint?) {
        if (requested == RouteKey(deliveryId, pickup, dropoff)) {
            job?.cancel()
            job = null
        }
    }

    fun load(deliveryId: String, pickup: GeoPoint?, dropoff: GeoPoint?) {
        val key = RouteKey(deliveryId, pickup, dropoff)
        if (requested == key && (line.size > 1 || job?.isActive == true)) return
        job?.cancel()
        requested = key
        line = cache[key].orEmpty()
        if (line.size > 1) return
        job = viewModelScope.launch {
            val road = bids.requestRoad(deliveryId)
            if (requested == key) {
                line = road
                if (road.size > 1 && pickup != null && dropoff != null) {
                    cache[key] = road
                    while (cache.size > 12) cache.remove(cache.keys.first())
                }
            }
        }
    }
}

@Composable
fun RequestMapOverlay(
    offer: OfferResponse,
    nowMillis: Long,
    accepting: Boolean,
    submittingBid: Boolean,
    submitProgress: OfferActionProgress? = null,
    statusLabel: String?,
    sentAmount: String?,
    bidsOpen: Boolean,
    error: String?,
    settled: Boolean = false,
    onAccept: () -> Unit,
    onBid: () -> Unit,
    onSubmitBid: (String) -> Unit,
    onDecline: () -> Unit,
    declining: Boolean,
    onInterest: () -> Unit,
    onClose: () -> Unit,
    routes: RequestRouteModel = hiltViewModel(),
) {
    val pickup = remember(offer.deliveryId, offer.pickup.latitude, offer.pickup.longitude) {
        parseGeoPoint(offer.pickup.latitude, offer.pickup.longitude)
    }
    val dropoff = remember(offer.deliveryId, offer.dropoff.latitude, offer.dropoff.longitude) {
        parseGeoPoint(offer.dropoff.latitude, offer.dropoff.longitude)
    }
    LaunchedEffect(offer.deliveryId, pickup, dropoff) { routes.load(offer.deliveryId, pickup, dropoff) }
    DisposableEffect(routes, offer.deliveryId, pickup, dropoff) {
        onDispose { routes.cancelPending(offer.deliveryId, pickup, dropoff) }
    }
    val density = LocalDensity.current
    var sheetHeight by remember { mutableStateOf(0.dp) }
    var recenter by remember { mutableIntStateOf(0) }
    var mapAttached by remember(offer.deliveryId) { mutableStateOf(false) }
    LaunchedEffect(offer.deliveryId) { mapAttached = true }
    val cardShape = RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp)
    Box(Modifier.fillMaxSize().background(RidersColors.background)) {
        if (mapAttached) RequestRouteMap(
            deliveryId = offer.deliveryId,
            pickup = pickup,
            dropoff = dropoff,
            line = routes.line,
            modifier = Modifier.fillMaxSize(),
            sheetOverlap = sheetHeight,
            recenter = recenter,
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(
                    top = with(density) { WindowInsets.statusBars.getTop(this).toDp() } + RidersSpacing.md,
                    end = RidersSpacing.lg,
                )
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button, onClick = onClose),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_close),
                contentDescription = "Close request",
                tint = RidersColors.text,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } }
                .shadow(12.dp, cardShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .clip(cardShape)
                .background(RidersColors.background)
                .padding(start = RidersSpacing.lg, end = RidersSpacing.lg, bottom = RidersSpacing.lg),
        ) {
            OfferRequestCard(
                offer = offer,
                nowMillis = nowMillis,
                accepting = accepting,
                submittingBid = submittingBid,
                submitProgress = submitProgress,
                statusLabel = statusLabel,
                sentAmount = sentAmount,
                bidsOpen = bidsOpen,
                onAccept = onAccept,
                onBid = onBid,
                onSubmitBid = onSubmitBid,
                onDecline = onDecline,
                declining = declining,
                submitError = error,
                onInterest = onInterest,
                settled = settled,
                mapDecline = true,
            )
            if (!error.isNullOrBlank()) {
                RidersFailureNotice(message = error)
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = RidersSpacing.lg, bottom = sheetHeight + RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button) { recenter += 1 },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_recenter),
                contentDescription = "Center map",
                tint = RidersColors.text,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

