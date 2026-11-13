package com.riders.rider

import com.riders.rider.core.design.AppearanceMode
import com.riders.rider.core.design.AppearanceSelection
import com.riders.rider.core.design.appearanceModeFromStored
import com.riders.rider.core.design.appearanceModeToStored
import org.junit.Assert.assertEquals
import org.junit.Test

class RiderAppearanceTest {
    @Test
    fun storedDarkAndLightRoundTripAndUnknownValuesStaySystem() {
        assertEquals(AppearanceMode.DARK, appearanceModeFromStored("dark"))
        assertEquals(AppearanceMode.LIGHT, appearanceModeFromStored("light"))
        assertEquals(AppearanceMode.SYSTEM, appearanceModeFromStored("system"))
        assertEquals(AppearanceMode.SYSTEM, appearanceModeFromStored(null))
        assertEquals(AppearanceMode.SYSTEM, appearanceModeFromStored("nope"))
        assertEquals("dark", appearanceModeToStored(AppearanceMode.DARK))
        assertEquals("light", appearanceModeToStored(AppearanceMode.LIGHT))
        assertEquals("system", appearanceModeToStored(AppearanceMode.SYSTEM))
    }

    @Test
    fun savedDarkLoadsAndALateSystemValueCannotReplaceANewerChoice() {
        val selection = AppearanceSelection()
        selection.onStored(AppearanceMode.DARK)
        assertEquals(AppearanceMode.DARK, selection.displayed)

        selection.onSelect(AppearanceMode.LIGHT)
        selection.onStored(AppearanceMode.SYSTEM)
        selection.onStored(AppearanceMode.DARK)
        assertEquals(AppearanceMode.LIGHT, selection.displayed)
    }

    @Test
    fun theFinalRapidChoiceWinsAndAnOlderSaveCannotRevertIt() {
        val selection = AppearanceSelection()
        selection.onSelect(AppearanceMode.DARK)
        val darkGeneration = selection.userGeneration
        selection.onSelect(AppearanceMode.LIGHT)
        val lightGeneration = selection.userGeneration

        selection.onPersistResult(darkGeneration, AppearanceMode.DARK, success = true)
        assertEquals(AppearanceMode.LIGHT, selection.displayed)

        selection.onPersistResult(lightGeneration, AppearanceMode.LIGHT, success = true)
        selection.onStored(AppearanceMode.LIGHT)
        assertEquals(AppearanceMode.LIGHT, selection.displayed)
    }

    @Test
    fun aFailedSaveRestoresTheLastPersistedChoice() {
        val selection = AppearanceSelection()
        selection.onStored(AppearanceMode.DARK)
        selection.onSelect(AppearanceMode.LIGHT)
        val generation = selection.userGeneration

        selection.onPersistResult(generation, AppearanceMode.LIGHT, success = false)
        assertEquals(AppearanceMode.DARK, selection.displayed)
    }

    @Test
    fun aFailedOlderSaveDoesNotUndoTheNewestChoice() {
        val selection = AppearanceSelection()
        selection.onSelect(AppearanceMode.DARK)
        val darkGeneration = selection.userGeneration
        selection.onSelect(AppearanceMode.SYSTEM)
        selection.onPersistResult(darkGeneration, AppearanceMode.DARK, success = false)
        assertEquals(AppearanceMode.SYSTEM, selection.displayed)
    }
}
