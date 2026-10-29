package com.repcoun.app

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * RepCoun's Health Connect privacy / data-usage rationale screen.
 *
 * REQUIRED by Health Connect: the permission screen links to it via
 * `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` (Android 13) and the
 * `ViewPermissionUsageActivity` alias (Android 14+). Without these, the
 * Health Connect permission dialog silently fails to launch on Android 14+
 * and the user never sees any permission prompt at all.
 */
class PermissionsRationaleActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "RepCoun"

        val density = resources.displayMetrics.density
        val pad = (22 * density).toInt()
        val ink = 0xFF16141F.toInt()

        fun label(value: String, sizeSp: Float, bold: Boolean, topDp: Float): TextView {
            val tv = TextView(this)
            tv.text = value
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            tv.setTextColor(ink)
            tv.setPadding(0, (topDp * density).toInt(), 0, 0)
            if (bold) tv.typeface = Typeface.DEFAULT_BOLD
            return tv
        }

        val column = LinearLayout(this)
        column.orientation = LinearLayout.VERTICAL
        column.setPadding(pad, pad, pad, pad)
        column.addView(label("RepCoun & Health Connect", 22f, true, 0f))
        column.addView(label("RepCoun asks Health Connect for:", 16f, false, 16f))
        column.addView(
            label(
                "• Heart rate — read from your watch\n" +
                    "• Workouts — read sessions recorded by other apps (Home Workout, Samsung Health, …)\n" +
                    "• Workouts & calories — written by RepCoun after each workout",
                15f,
                false,
                8f
            )
        )
        column.addView(
            label(
                "Your health data stays on your phone, inside Health Connect. " +
                    "You can allow or remove these permissions anytime in " +
                    "Health Connect → App permissions → RepCoun.",
                15f,
                false,
                16f
            )
        )

        val scroll = ScrollView(this)
        scroll.addView(column)
        setContentView(scroll)
    }
}
