package com.riders.rider.core.design

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
    val primaryLight = Color(0xFFE9F8EF)
    val background = Color(0xFFFFFFFF)
    val surface = Color(0xFFF1FAF5)
    val canvas = Color(0xFFF7FCF9)
    val text = Color(0xFF17211D)
    val textSecondary = Color(0xFF8A9690)
    val textInverse = Color(0xFFFFFFFF)
    val border = Color(0xFFE1E8E3)
    val error = Color(0xFFD92D20)
    val dangerSurface = Color(0xFFFEF2F2)
    val shadow = Color(0x1417211D)
    val focusRing = Color(0x38169B62)
    val errorRing = Color(0x38D92D20)
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
    val brandLetter = TextStyle(fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.Black)
    val brandName = TextStyle(fontSize = 18.sp, lineHeight = 22.sp, fontWeight = FontWeight.ExtraBold)
    val brandCaption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal, letterSpacing = 4.sp)
}
