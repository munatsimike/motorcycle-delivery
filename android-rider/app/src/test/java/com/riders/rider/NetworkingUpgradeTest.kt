package com.riders.rider

import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.BidSubmissionRequest
import com.riders.rider.core.network.PhoneRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.httpClient
import com.riders.rider.core.network.retrofit
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

class NetworkingUpgradeTest {
    @Test
    fun gzipAndUnknownFieldsAreHandledByTheOfficialConverter() = runTest {
        val json = """{"status":"pending","newServerField":true}"""
        val compressed = ByteArrayOutputStream().apply {
            GZIPOutputStream(this).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        }.toByteArray()
        MockWebServer().use { server ->
            server.enqueue(MockResponse()
                .setHeader("Content-Type", "application/json")
                .setHeader("Content-Encoding", "gzip")
                .setBody(Buffer().write(compressed)))
            server.start()
            val auth = retrofit(server.url("/").toString(), httpClient()).create(AuthService::class.java)
            assertEquals("pending", auth.resendWhatsAppLogin(PhoneRequest("+263771234567")).status)
            val sent = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            assertEquals("/auth/rider/login/whatsapp/resend", sent.path)
            assertEquals("gzip", sent.getHeader("Accept-Encoding"))
            assertEquals("+263771234567", Json.parseToJsonElement(sent.body.readUtf8())
                .jsonObject.getValue("phone").jsonPrimitive.content)
        }
    }

    @Test
    fun bidAmountCurrencyAndIdempotencyHeaderSurviveMigration() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
                """{"id":"bid-1","deliveryId":"delivery-1","amount":"12.50","currency":"USD","status":"OPEN","createdAt":"2026-11-26T08:00:00Z"}"""
            ))
            server.start()
            val service = retrofit(server.url("/").toString(), httpClient()).create(RiderService::class.java)
            val result = service.submitBid("retry-key-1", BidSubmissionRequest("delivery-1", 1250, "USD"))
            assertEquals("bid-1", result.id)
            assertEquals("12.50", result.amount)
            val sent = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            assertEquals("POST", sent.method)
            assertEquals("/riders/me/bids", sent.path)
            assertEquals("retry-key-1", sent.getHeader("Idempotency-Key"))
            assertTrue(sent.getHeader("Content-Type").orEmpty().startsWith("application/json"))
            val body = Json.parseToJsonElement(sent.body.readUtf8()).jsonObject
            assertEquals("delivery-1", body.getValue("deliveryId").jsonPrimitive.content)
            assertEquals(1250, body.getValue("amountCents").jsonPrimitive.int)
            assertEquals("USD", body.getValue("currency").jsonPrimitive.content)
        }
    }

    @Test
    fun profilePhotoStillReturnsRawBytes() = runTest {
        val bytes = byteArrayOf(0, 1, 23, -1, 0, 42)
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "image/webp")
                .setBody(Buffer().write(bytes)))
            server.start()
            val service = retrofit(server.url("/").toString(), httpClient()).create(RiderService::class.java)
            service.profilePhoto().use { response ->
                assertEquals("image/webp", response.contentType()?.toString())
                assertArrayEquals(bytes, response.bytes())
            }
        }
    }
}
