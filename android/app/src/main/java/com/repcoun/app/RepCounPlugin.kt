package com.repcoun.app

import android.content.Context
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.runBlocking
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.Executors

/**
 * RepCoun native bridge — camera permission + Health Connect.
 * Health Connect syncs workouts from any watch (Galaxy Watch, Redmi Watch, …)
 * through Samsung Health / Mi Fitness.
 */
@CapacitorPlugin(name = "RepCoun")
class RepCounPlugin : Plugin() {

    private val executor = Executors.newSingleThreadExecutor()

    private fun io(): Context = requireNotNull(context)

    /* ------------------------------ camera ------------------------------ */

    @PluginMethod
    fun requestCamera(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(
            io(), android.Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        if (granted) {
            val data = JSObject()
            data.put("granted", true)
            call.resolve(data)
            return
        }
        cameraCall = call
        activity?.let { (it as? MainActivity)?.launchCameraPermission() } ?: run {
            val data = JSObject()
            data.put("granted", false)
            call.resolve(data)
        }
    }

    /* -------------------------- Health Connect --------------------------- */

    @PluginMethod
    fun hcAvailability(call: PluginCall) {
        val data = JSObject()
        data.put("available", sdkAvailable())
        call.resolve(data)
    }

    private fun sdkAvailable(): Boolean = try {
        if (Build.VERSION.SDK_INT >= 34) {
            HealthConnectClient.getSdkStatus(io()) == HealthConnectClient.SDK_AVAILABLE
        } else {
            // Pre-14 devices need the Health Connect app from Play Store
            HealthConnectClient.getSdkStatus(io()) == HealthConnectClient.SDK_AVAILABLE
        }
    } catch (t: Throwable) {
        false
    }

    @PluginMethod
    fun hcStatus(call: PluginCall) {
        executor.execute {
            val data = JSObject()
            data.put("granted", if (sdkAvailable()) allGranted() else false)
            call.resolve(data)
        }
    }

    private fun allGranted(): Boolean = try {
        val client = HealthConnectClient.getOrCreate(io())
        HC_PERMISSIONS.all { perm ->
            runBlocking {
                client.permissionController.checkSelfPermission(perm) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        }
    } catch (t: Throwable) {
        false
    }

    @PluginMethod
    fun hcRequestPermissions(call: PluginCall) {
        if (!sdkAvailable()) {
            val data = JSObject()
            data.put("granted", false)
            call.resolve(data)
            return
        }
        if (allGranted()) {
            val data = JSObject()
            data.put("granted", true)
            call.resolve(data)
            return
        }
        hcCall = call
        activity?.let { (it as? MainActivity)?.launchHcPermissions() } ?: run {
            val data = JSObject()
            data.put("granted", false)
            call.resolve(data)
        }
    }

    @PluginMethod
    fun hcReadHeartRate(call: PluginCall) {
        executor.execute {
            val data = JSObject()
            try {
                val client = HealthConnectClient.getOrCreate(io())
                val now = Instant.now()
                val since = now.minus(Duration.ofMinutes(15))
                val response = runBlocking {
                    client.readRecords(
                        ReadRecordsRequest(
                            recordType = HeartRateRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(since, now)
                        )
                    )
                }
                val samples = response.records
                    .flatMap { it.samples }
                    .sortedBy { it.time }
                if (samples.isNotEmpty()) {
                    val recent = samples.takeLast(8)
                    val bpm = recent.map { it.bpm }.average()
                    data.put("bpm", Math.round(bpm))
                    data.put("at", samples.last().time.toEpochMilli())
                } else {
                    data.put("bpm", JSObject.NULL)
                    data.put("at", JSObject.NULL)
                }
            } catch (t: Throwable) {
                data.put("bpm", JSObject.NULL)
                data.put("at", JSObject.NULL)
            }
            call.resolve(data)
        }
    }

    @PluginMethod
    fun hcWriteSession(call: PluginCall) {
        executor.execute {
            val data = JSObject()
            try {
                val startMs = call.getDouble("startMs")!!.toLong()
                val endMs = call.getDouble("endMs")!!.toLong()
                val kcal = call.getDouble("kcal") ?: 0.0
                val exerciseId = call.getString("exerciseId") ?: "mixed"

                val start = Instant.ofEpochMilli(startMs)
                val end = Instant.ofEpochMilli(endMs)
                val zone: ZoneOffset = ZoneOffset.UTC

                val session = ExerciseSessionRecord(
                    startTime = start,
                    startZoneOffset = zone,
                    endTime = end,
                    endZoneOffset = zone,
                    exerciseType = exerciseTypeFor(exerciseId),
                    title = "RepCoun · $exerciseId"
                )
                val active = ActiveCaloriesBurnedRecord(
                    startTime = start,
                    startZoneOffset = zone,
                    endTime = end,
                    endZoneOffset = zone,
                    energy = Energy.calories(kcal)
                )
                val total = TotalCaloriesBurnedRecord(
                    startTime = start,
                    startZoneOffset = zone,
                    endTime = end,
                    endZoneOffset = zone,
                    energy = Energy.calories(kcal)
                )

                val client = HealthConnectClient.getOrCreate(io())
                runBlocking { client.insertRecords(listOf(session, active, total)) }
                data.put("ok", true)
            } catch (t: Throwable) {
                data.put("ok", false)
                data.put("error", t.message ?: "unknown")
            }
            call.resolve(data)
        }
    }

    /* ------------------------------ helpers ------------------------------ */

    override fun handleOnResume() {
        super.handleOnResume()
    }

    companion object {
        @Volatile
        private var cameraCall: PluginCall? = null

        @Volatile
        private var hcCall: PluginCall? = null

        val HC_PERMISSIONS: Set<String> = setOf(
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
            HealthPermission.getWritePermission(ExerciseSessionRecord::class),
            HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getWritePermission(TotalCaloriesBurnedRecord::class)
        )

        @JvmStatic
        fun resolveCamera(granted: Boolean) {
            cameraCall?.let { call ->
                cameraCall = null
                val data = JSObject()
                data.put("granted", granted)
                call.resolve(data)
            }
        }

        @JvmStatic
        fun resolveHc(granted: Boolean) {
            hcCall?.let { call ->
                hcCall = null
                val data = JSObject()
                data.put("granted", granted)
                call.resolve(data)
            }
        }

        /**
         * Map RepCoun exercise ids to Health Connect exercise types.
         * Constants are resolved reflectively so the code compiles against
         * every version of the Health Connect library.
         */
        private fun exerciseTypeFor(id: String): Int {
            val constant = when (id) {
                "pushup" -> "EXERCISE_PUSH_UPS"
                "squat" -> "EXERCISE_SQUATS"
                "situp" -> "EXERCISE_SIT_UPS"
                "pullup" -> "EXERCISE_PULL_UPS"
                "lunge" -> "EXERCISE_LUNGES"
                "burpee" -> "EXERCISE_BURPEES"
                "jumpingjack" -> "EXERCISE_JUMPING_JACK"
                "bicepcurl" -> "EXERCISE_BICEP_CURLS"
                "plank" -> "EXERCISE_PLANK"
                "mountainclimber" -> "EXERCISE_MOUNTAIN_CLIMBER"
                else -> "EXERCISE_GENERIC_WORKOUT"
            }
            return try {
                val field = ExerciseSessionRecord::class.java.getField(constant)
                field.getInt(null)
            } catch (t: Throwable) {
                try {
                    val fallback = ExerciseSessionRecord::class.java.getField("EXERCISE_GENERIC_WORKOUT")
                    fallback.getInt(null)
                } catch (t2: Throwable) {
                    0
                }
            }
        }
    }
}
