package com.riders.rider.core.design

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Tokens copied from customer-app/src/theme and the shared components that use them.
 */
object RidersColors {
    val primary = Color(0xFF169B62)
    val primaryDark = Color(0xFF087A4A)
    var primaryLight by mutableStateOf(Color(0xFFE9F8EF))
        private set
    var background by mutableStateOf(Color(0xFFFFFFFF))
        private set
    var surface by mutableStateOf(Color(0xFFF1FAF5))
        private set
    var canvas by mutableStateOf(Color(0xFFF7FCF9))
        private set
    var sheet by mutableStateOf(Color(0xFFFFFFFF))
        private set
    var card by mutableStateOf(Color(0xFFF8FAF9))
        private set
    var text by mutableStateOf(Color(0xFF17211D))
        private set
    var textSecondary by mutableStateOf(Color(0xFF8A9690))
        private set
    val textInverse = Color(0xFFFFFFFF)
    var border by mutableStateOf(Color(0xFFE1E8E3))
        private set
    var error by mutableStateOf(Color(0xFFD92D20))
        private set
    var dangerSurface by mutableStateOf(Color(0xFFFEF2F2))
        private set
    var shadow by mutableStateOf(Color(0x1417211D))
        private set
    val focusRing = Color(0x38169B62)
    var errorRing by mutableStateOf(Color(0x38D92D20))
        private set
    var mintStart by mutableStateOf(Color(0xFFC9EFD9))
        private set
    var mintMid by mutableStateOf(Color(0xFFE5F7EE))
        private set
    var mintEnd by mutableStateOf(Color(0xFFF7FCF9))
        private set

    fun apply(dark: Boolean) {
        if (dark) {
            primaryLight = Color(0xFF16352A)
            background = Color(0xFF101614)
            surface = Color(0xFF1A2420)
            canvas = Color(0xFF101614)
            sheet = Color(0xFF17211D)
            card = Color(0xFF1A2420)
            text = Color(0xFFF3F7F5)
            textSecondary = Color(0xFF9AABA3)
            border = Color(0xFF2C3A34)
            error = Color(0xFFF97066)
            dangerSurface = Color(0xFF3A1C1C)
            shadow = Color(0x66000000)
            errorRing = Color(0x38F97066)
            mintStart = Color(0xFF16352A)
            mintMid = Color(0xFF14241E)
            mintEnd = Color(0xFF101614)
        } else {
            primaryLight = Color(0xFFE9F8EF)
            background = Color(0xFFFFFFFF)
            surface = Color(0xFFF1FAF5)
            canvas = Color(0xFFF7FCF9)
            sheet = Color(0xFFFFFFFF)
            card = Color(0xFFF8FAF9)
            text = Color(0xFF17211D)
            textSecondary = Color(0xFF8A9690)
            border = Color(0xFFE1E8E3)
            error = Color(0xFFD92D20)
            dangerSurface = Color(0xFFFEF2F2)
            shadow = Color(0x1417211D)
            errorRing = Color(0x38D92D20)
            mintStart = Color(0xFFC9EFD9)
            mintMid = Color(0xFFE5F7EE)
            mintEnd = Color(0xFFF7FCF9)
        }
    }
}

object RidersSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

object RidersRadius {
    val md = 12.dp
    val lg = 14.dp
    val xl = 28.dp
    val pill = 999.dp
}

object RidersType {
    val title = TextStyle(fontSize = 25.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold)
    val heading = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold)
    val body = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    val bodyStrong = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val caption = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    val captionStrong = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Bold)
    val small = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
    val button = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold)
}
