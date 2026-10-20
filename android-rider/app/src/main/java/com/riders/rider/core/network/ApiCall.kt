package com.riders.rider.core.network

import retrofit2.HttpException
import java.io.IOException
import java.io.InterruptedIOException

suspend fun <T> apiCall(establishedSession: Boolean = true, block: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Ok(block())
    } catch (error: HttpException) {
        ApiResult.Err(mapHttpFailure(error.code(), error.response()?.errorBody()?.string(), establishedSession))
    } catch (error: IOException) {
        ApiResult.Err(ioFailure(error))
    }
}

/**
 * OkHttp's call timeout can wrap the authenticator's [IOException] in
 * [InterruptedIOException] after the refresh attempt has already been classified.
 * The classified failure is the one the rider should see.
 */
private fun ioFailure(error: IOException): ApiError {
    error.findCause<SessionStorageException>()?.let {
        return ApiError.Unexpected(SessionStorageException.MESSAGE)
    }
    error.findCause<RefreshRecoverableException>()?.let {
        return refreshFailure(it.failure)
    }
    return if (error.findCause<InterruptedIOException>() != null) {
        ApiError.Timeout
    } else {
        ApiError.Network
    }
}

private inline fun <reified T : Throwable> Throwable.findCause(): T? {
    var current: Throwable? = this
    var depth = 0
    while (current != null && depth < 8) {
        if (current is T) {
            return current
        }
        current = current.cause
        depth += 1
    }
    return null
}

private fun refreshFailure(failure: RefreshAttempt): ApiError {
    return when (failure) {
        RefreshAttempt.TimedOut -> ApiError.Timeout
        RefreshAttempt.Unavailable -> ApiError.Unexpected("The server could not refresh your session. Try again.")
        RefreshAttempt.Unreachable -> ApiError.Network
        is RefreshAttempt.Success,
        RefreshAttempt.Rejected,
        -> ApiError.Network
    }
}
