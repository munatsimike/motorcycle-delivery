package com.riders.rider.feature.delivery.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.decodeEncodedPolyline
import com.riders.rider.feature.delivery.domain.decodeRouteLine
import com.riders.rider.feature.delivery.domain.deliveryRouteKey
import com.riders.rider.feature.delivery.domain.drivingRouteLine
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import javax.inject.Inject
import javax.inject.Singleton

data class PickupRoad(
    val line: List<GeoPoint>,
    val metres: Double?,
    val seconds: Int?,
)

@Singleton
class PickupRouteRepository @Inject constructor(
    private val riders: RiderService,
) {
    private val deliveryRoads = LinkedHashMap<String, List<GeoPoint>>(16, 0.75f, true)

    suspend fun road(assignmentId: String, origin: GpsFix): PickupRoad? {
        return when (val result = apiCall { riders.pickupRoute(assignmentId, origin.latitude, origin.longitude) }) {
            is ApiResult.Ok -> {
                val decoded = decodeEncodedPolyline(result.value.geometry)
                val line = if (decoded.size > 1) {
                    decoded
                } else {
                    decodeRouteLine(result.value.line.mapNotNull { parseGeoPoint(it.latitude.toString(), it.longitude.toString()) })
                }
                val summary = result.value.takeIf { line.size > 1 }
                PickupRoad(line, summary?.metres, summary?.seconds)
            }
            is ApiResult.Err -> null
        }
    }

    suspend fun deliveryRoad(assignmentId: String, pickup: GeoPoint, dropoff: GeoPoint): List<GeoPoint> {
        val key = deliveryRouteKey(pickup, dropoff)
        deliveryRoads[key]?.let { return it }
        val result = try {
            apiCall { riders.deliveryRoute(assignmentId) }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            android.util.Log.i("CollectedRoute", "request threw ${error.javaClass.simpleName}")
            return emptyList()
        }
        val road = when (result) {
            is ApiResult.Ok -> {
                val decoded = decodeEncodedPolyline(result.value.geometry)
                val points = if (decoded.size > 2) {
                    decoded
                } else {
                    decodeRouteLine(result.value.line.mapNotNull { parseGeoPoint(it.latitude.toString(), it.longitude.toString()) })
                }
                drivingRouteLine(points)
            }
            is ApiResult.Err -> {
                android.util.Log.i("CollectedRoute", "request failed ${result.error.javaClass.simpleName}")
                emptyList()
            }
        }
        if (road.size > 2) {
            deliveryRoads[key] = road
            while (deliveryRoads.size > 20) {
                val oldest = deliveryRoads.entries.firstOrNull()?.key ?: break
                deliveryRoads.remove(oldest)
            }
        }
        return road
    }

    /** Road from a fresh rider fix to the drop-off. Callers reject a line that does not start at the rider. */
    suspend fun approachDropoff(assignmentId: String, origin: GpsFix): PickupRoad {
        val result = try {
            apiCall { riders.deliveryRoute(assignmentId, origin.latitude, origin.longitude) }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return PickupRoad(emptyList(), null, null)
        }
        return when (result) {
            is ApiResult.Ok -> {
                val decoded = decodeEncodedPolyline(result.value.geometry)
                val points = if (decoded.size > 2) {
                    decoded
                } else {
                    decodeRouteLine(result.value.line.mapNotNull { parseGeoPoint(it.latitude.toString(), it.longitude.toString()) })
                }
                val line = drivingRouteLine(points)
                val summary = result.value.takeIf { line.size > 2 }
                PickupRoad(line, summary?.metres, summary?.seconds)
            }
            is ApiResult.Err -> PickupRoad(emptyList(), null, null)
        }
    }
}
