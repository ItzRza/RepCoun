package com.repcoun.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/**
 * RepCoun on the watch — start/stop the phone workout, live rep count + heart
 * rate. Blue design matching the phone app: black surfaces, soft blue-gray
 * text, a blue accent button.
 */
class MainActivity : Activity() {

    private val ui = Handler(Looper.getMainLooper())

    private lateinit var statusText: TextView
    private lateinit var exText: TextView
    private lateinit var repText: TextView
    private lateinit var hrText: TextView
    private lateinit var infoText: TextView
    private lateinit var startBtn: Button

    private var sessionOn = false     // local sensor service running
    private var phoneActive = false   // phone workout open
    private var reps = 0
    private var bpm = 0

    private var linkOff: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()

        WatchLink.init(this)
        linkOff = WatchLink.subscribe { path, data ->
            ui.post { handleLink(path, data) }
        }

        startBtn.setOnClickListener { toggle() }

        // 4s ticker: re-poll the phone connection + refresh mirrored state
        ui.post(object : Runnable {
            override fun run() {
                WatchLink.checkOnce()
                refresh()
                ui.postDelayed(this, 4000)
            }
        })
    }

    override fun onDestroy() {
        linkOff?.invoke()
        ui.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    /* ------------------------------ events ------------------------------ */

    private fun handleLink(path: String, data: JSONObject) {
        when (path) {
            "conn" -> refresh()
            "rep" -> {
                reps = data.optInt("n", reps + 1)
                refresh()
            }
            "hr" -> {
                bpm = data.optInt("bpm", bpm)
                refresh()
            }
            "service" -> {
                sessionOn = data.optBoolean("on", sessionOn)
                refresh()
            }
            "state" -> {
                // phone workout opened/closed — mirror it locally (HR streams
                // to the phone either way)
                val active = data.optBoolean("active", false)
                phoneActive = active
                if (active && !sessionOn) startLocal()
                if (!active && sessionOn) stopLocal()
                refresh()
            }
            "config" -> refresh()
        }
    }

    private fun toggle() {
        if (sessionOn || phoneActive) {
            stopLocal()
            WatchLink.send("stop", JSONObject().put("ts", System.currentTimeMillis()))
        } else {
            startLocal()
            WatchLink.send(
                "start",
                JSONObject().put("exercise", "auto").put("source", "watch")
                    .put("ts", System.currentTimeMillis())
            )
            requestHrPermission()
        }
        refresh()
    }

    private fun startLocal() {
        if (sessionOn) return
        try {
            startForegroundService(Intent(this, WorkoutService::class.java))
            sessionOn = true
            reps = 0
            bpm = 0
        } catch (t: Throwable) {
        }
    }

    private fun stopLocal() {
        if (!sessionOn) return
        try {
            stopService(Intent(this, WorkoutService::class.java))
        } catch (t: Throwable) {
        }
        sessionOn = false
    }

    private fun requestHrPermission() {
        try {
            if (checkSelfPermission(Manifest.permission.BODY_SENSORS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(arrayOf(Manifest.permission.BODY_SENSORS), 772)
            }
        } catch (t: Throwable) {
        }
    }

    /* -------------------------------- UI -------------------------------- */

    private fun buildUi() {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(30), dp(24), dp(24))
            setBackgroundColor(BG)
        }

        statusText = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(MUTED)
        }
        exText = TextView(this).apply {
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(ACCENT)
            setPadding(0, dp(6), 0, 0)
        }
        repText = TextView(this).apply {
            textSize = 64f
            gravity = Gravity.CENTER
            setTextColor(TEXT)
            setPadding(0, dp(14), 0, 0)
        }
        val repsLabel = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(MUTED)
            text = "REPS"
        }
        hrText = TextView(this).apply {
            textSize = 17f
            gravity = Gravity.CENTER
            setTextColor(HR_RED)
            setPadding(0, dp(10), 0, 0)
        }
        startBtn = Button(this).apply {
            textSize = 17f
            setTextColor(Color.WHITE)
            setBackgroundColor(BTN)
            setPadding(dp(20), dp(12), dp(20), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(18)
                bottomMargin = dp(6)
            }
        }
        infoText = TextView(this).apply {
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(MUTED)
            setPadding(0, dp(10), 0, 0)
        }

        col.addView(statusText)
        col.addView(exText)
        col.addView(repText)
        col.addView(repsLabel)
        col.addView(hrText)
        col.addView(startBtn)
        col.addView(infoText)

        setContentView(ScrollView(this).apply {
            setBackgroundColor(BG)
            isFillViewport = true
            addView(col)
        })
        refresh()
    }

    private fun refresh() {
        val on = sessionOn || phoneActive

        statusText.text = if (WatchLink.connected) "● ${WatchLink.nodeName}" else "○ phone not connected"
        statusText.setTextColor(if (WatchLink.connected) GREEN else MUTED)

        exText.text = if (on) "Full body · Auto" else ""
        repText.text = reps.toString()
        hrText.text = when {
            bpm > 0 -> "♥ $bpm bpm"
            on -> "♥ --"
            else -> "♥ -- bpm"
        }

        startBtn.text = when {
            phoneActive -> "FINISH"
            on -> "STOP"
            else -> "START"
        }
        startBtn.setBackgroundColor(if (on) BTN_ACTIVE else BTN)

        infoText.text = when {
            !WatchLink.connected -> "Open RepCoun on your phone — sign in and the watch connects by itself"
            phoneActive -> "Phone is counting with the camera"
            on -> "Counting on your watch"
            else -> "Ready — tap START"
        }
    }

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density + 0.5f).toInt()

    companion object {
        private val BG = Color.parseColor("#0a0d13")        // black, soft blue hint
        private val TEXT = Color.parseColor("#e9eef7")
        private val MUTED = Color.parseColor("#7a8699")      // soft blue-gray
        private val ACCENT = Color.parseColor("#4d8dff")
        private val BTN = Color.parseColor("#2563eb")
        private val BTN_ACTIVE = Color.parseColor("#1d4fd8")
        private val GREEN = Color.parseColor("#22c55e")
        private val HR_RED = Color.parseColor("#ef4444")
    }
}
