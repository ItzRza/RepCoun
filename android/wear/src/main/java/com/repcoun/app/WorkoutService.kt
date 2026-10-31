package com.repcoun.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.IBinder
import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.sqrt

/**
 * Foreground service — reads the watch sensors while a session runs:
 *   gyro + accel → wrist rep counting, heart rate → phone (calories).
 *
 * Rep detection: smoothed motion energy (envelope) with hysteresis — a rise
 * above HIGH starts a phase, a fall below LOW ends it; two half-cycles
 * (up + down) = one rep. Works for curls, push-ups, squats, planks, …
 */
class WorkoutService : Service(), SensorEventListener {

    private var sensorManager: SensorManager? = null
    private var lastHrSend = 0L

    // --- wrist rep detection state ---
    private var envGyro = 0f
    private var envAccel = 0f
    private var activePhase = false
    private var halfCycles = 0
    private var lastFlip = 0L
    private var lastRepAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(SENSOR_SERVICE) as? SensorManager
        startForeground(1, buildNotification())
        repCount = 0

        val sm = sensorManager ?: return
        try {
            sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
                sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            }
        } catch (t: Throwable) {
        }
        try {
            sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
                sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            }
        } catch (t: Throwable) {
        }
        try {
            sm.getDefaultSensor(Sensor.TYPE_HEART_RATE)?.let {
                sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            }
        } catch (t: Throwable) {
            // No HR sensor or BODY_SENSORS not granted yet
        }
        WatchLink.emitLocal("service", JSONObject().put("on", true))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            sensorManager?.unregisterListener(this)
        } catch (t: Throwable) {
        }
        WatchLink.emitLocal("service", JSONObject().put("on", false))
        super.onDestroy()
    }

    override fun onSensorChanged(event: SensorEvent?) {
        event ?: return
        when (event.sensor.type) {
            Sensor.TYPE_HEART_RATE -> {
                val bpm = event.values.getOrNull(0)?.toInt() ?: 0
                if (bpm <= 0) return
                val now = SystemClock.elapsedRealtime()
                // throttle to 1 Hz — enough for the calorie math, gentle on the battery
                if (now - lastHrSend >= 1000) {
                    lastHrSend = now
                    val d = JSONObject().put("bpm", bpm).put("ts", System.currentTimeMillis())
                    WatchLink.emitLocal("hr", d)
                    WatchLink.send("hr", d)
                }
            }
            Sensor.TYPE_GYROSCOPE -> {
                val g = sqrt(sq(event.values[0]) + sq(event.values[1]) + sq(event.values[2]))
                envGyro += (g - envGyro) * 0.25f
                detectRep()
            }
            Sensor.TYPE_ACCELEROMETER -> {
                val a = sqrt(sq(event.values[0]) + sq(event.values[1]) + sq(event.values[2]))
                val lin = kotlin.math.abs(a - 9.81f)
                envAccel += (lin - envAccel) * 0.25f
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
    }

    /** Two half-cycles of wrist motion = one rep. */
    private fun detectRep() {
        val now = SystemClock.elapsedRealtime()
        val sig = if (envAccel / 5f > envGyro) envAccel / 5f else envGyro
        if (now - lastRepAt < REP_COOLDOWN) return
        if (!activePhase && sig > HIGH && now - lastFlip > MIN_FLIP_MS) {
            activePhase = true
            lastFlip = now
        } else if (activePhase && sig < LOW && now - lastFlip > MIN_FLIP_MS) {
            activePhase = false
            lastFlip = now
            halfCycles++
            if (halfCycles >= 2) {
                halfCycles = 0
                lastRepAt = now
                repCount++
                val d = JSONObject().put("n", repCount).put("ts", System.currentTimeMillis())
                WatchLink.emitLocal("rep", d)
                WatchLink.send("rep", d)
            }
        }
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        try {
            nm.createNotificationChannel(
                NotificationChannel("workout", "Workout", NotificationManager.IMPORTANCE_LOW)
            )
        } catch (t: Throwable) {
        }
        return Notification.Builder(this, "workout")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("RepCoun")
            .setContentText("Counting reps from your watch…")
            .setOngoing(true)
            .build()
    }

    companion object {
        /** Live rep count of the running session (0 = fresh). */
        @Volatile
        var repCount: Int = 0

        private const val HIGH = 2.1f      // motion energy to start a phase
        private const val LOW = 0.65f      // energy below this = back to rest
        private const val MIN_FLIP_MS = 220L
        private const val REP_COOLDOWN = 350L

        private fun sq(v: Float): Float = v * v
    }
}
