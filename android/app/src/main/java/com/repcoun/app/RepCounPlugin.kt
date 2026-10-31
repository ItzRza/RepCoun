package com.repcoun.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.Executors
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException

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
        val act = activity as? MainActivity
        if (act != null) {
            act.runOnUiThread { act.launchCameraPermission() }
        } else {
            val data = JSObject()
            data.put("granted", false)
            call.resolve(data)
        }
    }

    /* ----------------------------- app info ----------------------------- */

    @PluginMethod
    fun appVersion(call: PluginCall) {
        val data = JSObject()
        data.put("version", BuildConfig.VERSION_NAME)
        data.put("build", BuildConfig.VERSION_CODE)
        // Device diagnostics — visible in Profile → About for support.
        data.put("android", Build.VERSION.RELEASE)
        data.put("sdk", Build.VERSION.SDK_INT)
        data.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        data.put("hcStatus", hcSdkStatus())
        call.resolve(data)
    }

    /**
     * Opens this app's system settings page. Used when a permission dialog is
     * blocked by the phone (auto-deny) — the only way forward is letting the
     * user enable it manually in Settings.
     */
    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        try {
            val intent = Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", io().packageName, null)
            )
            activity?.startActivity(intent)
        } catch (ignored: Throwable) {
            // No settings screen available on this device — ignore
        }
        call.resolve(JSObject())
    }

    /**
     * Google Sign-In — returns an ID token that the web side trades for a
     * Firebase login. Uses the native Google dialog because web popups are
     * blocked inside Android WebViews.
     */
    @PluginMethod
    fun googleSignIn(call: PluginCall) {
        val webClientId = call.getString("webClientId") ?: ""
        if (webClientId.isEmpty()) {
            val d = JSObject()
            d.put("error", "Google Sign-In not configured")
            call.resolve(d)
            return
        }
        val act = activity as? MainActivity
        if (act == null) {
            val d = JSObject()
            d.put("error", "no activity")
            call.resolve(d)
            return
        }
        googleCall = call
        try {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(webClientId)
                .requestEmail()
                .build()
            val intent = GoogleSignIn.getClient(act, gso).signInIntent
            act.runOnUiThread {
                try {
                    act.launchGoogleSignIn(intent)
                } catch (t: Throwable) {
                    resolveGoogleError(t.message ?: "google sign-in failed")
                }
            }
        } catch (t: Throwable) {
            resolveGoogleError(t.message ?: "google sign-in failed")
        }
    }

    /* -------------------------- Health Connect --------------------------- */

    @PluginMethod
    fun hcAvailability(call: PluginCall) {
        val data = JSObject()
        val status = hcSdkStatus()
        data.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        data.put(
            "updateRequired",
            status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        )
        data.put("status", status)
        call.resolve(data)
    }

    /** 0 = ready · 1 = not available on this device · 2 = install / update required */
    private fun hcSdkStatus(): Int = try {
        HealthConnectClient.getSdkStatus(io())
    } catch (t: Throwable) {
        HealthConnectClient.SDK_UNAVAILABLE
    }

    private fun sdkAvailable(): Boolean = hcSdkStatus() == HealthConnectClient.SDK_AVAILABLE

    @PluginMethod
    fun hcStatus(call: PluginCall) {
        executor.execute {
            val data = JSObject()
            val count = if (sdkAvailable()) grantedCount() else 0
            // ANY granted permission counts as connected — requiring all six made
            // manual grants in Health Connect look like "Not connected".
            data.put("granted", count > 0)
            data.put("full", count >= HC_PERMISSIONS.size)
            data.put("count", count)
            data.put("total", HC_PERMISSIONS.size)
            data.put("error", grantError)
            val missing = org.json.JSONArray()
            for (p in HC_PERMISSIONS) {
                if (p !in grantedSet) missing.put(p.removePrefix("android.permission.health."))
            }
            data.put("missing", missing)
            call.resolve(data)
        }
    }

    /** Last error from reading grants — surfaced in diagnostics instead of hiding. */
    @Volatile
    private var grantError: String = ""

    /** Permission strings actually granted right now (empty on error). */
    @Volatile
    private var grantedSet: Set<String> = emptySet()

    /** How many of RepCoun's Health Connect permissions are granted right now. */
    private fun grantedCount(): Int = try {
        val client = HealthConnectClient.getOrCreate(io())
        val granted = runBlocking { client.permissionController.getGrantedPermissions() }
        grantedSet = granted
        grantError = ""
        HC_PERMISSIONS.count { it in granted }
    } catch (t: Throwable) {
        grantedSet = emptySet()
        grantError = "${t.javaClass.simpleName}: ${t.message}"
        0
    }

    @PluginMethod
    fun hcRequestPermissions(call: PluginCall) {
        val status = hcSdkStatus()
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            val data = JSObject()
            data.put("granted", false)
            data.put(
                "reason",
                if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) "update"
                else "unavailable"
            )
            call.resolve(data)
            return
        }
        if (grantedCount() > 0) {
            val data = JSObject()
            data.put("granted", true)
            call.resolve(data)
            return
        }
        hcCall = call
        hcRequestedAtMs = SystemClock.elapsedRealtime()
        val act = activity as? MainActivity
        if (act != null) {
            act.runOnUiThread { act.launchHcPermissions() }
        } else {
            val data = JSObject()
            data.put("granted", false)
            call.resolve(data)
        }
    }

    /**
     * Opens the Health Connect install/update page (Play Store), so a missing or
     * outdated Health Connect can be fixed with one tap.
     */
    @PluginMethod
    fun hcOpenStore(call: PluginCall) {
        val pkg = "com.google.android.apps.healthdata"
        val act = activity
        val targets = listOf(
            "market://details?id=$pkg",
            "https://play.google.com/store/apps/details?id=$pkg"
        )
        if (act != null) {
            var opened = false
            for (t in targets) {
                try {
                    act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(t)))
                    opened = true
                    break
                } catch (ignored: Throwable) {
                    // try the next target
                }
            }
            if (!opened) {
                // Last resort: Health Connect's own settings screen (Android 14+)
                try {
                    act.startActivity(Intent("android.healthconnect.action.MANAGE_HEALTH_PERMISSIONS"))
                } catch (ignored: Throwable) {
                }
            }
        }
        call.resolve(JSObject())
    }

    /**
     * Full Health Connect self-diagnosis. Displayed in the app, so one
     * screenshot shows exactly what is broken on the device.
     */
    @PluginMethod
    fun hcDiag(call: PluginCall) {
        executor.execute {
            val d = JSObject()
            val sdk = hcSdkStatus()
            d.put("sdk", sdk)
            d.put("sdkStr", if (sdk == 0) "available" else if (sdk == 2) "needs-update" else "unavailable")
            var provider = false
            try {
                io().packageManager.getPackageInfo("com.google.android.apps.healthdata", 0)
                provider = true
            } catch (ignored: Throwable) {
            }
            d.put("providerInstalled", provider)
            val count = if (sdk == 0) grantedCount() else 0
            d.put("grantError", grantError)
            d.put("count", count)
            d.put("total", HC_PERMISSIONS.size)
            val grantedArr = org.json.JSONArray()
            for (p in grantedSet) grantedArr.put(p.removePrefix("android.permission.health."))
            d.put("grantedList", grantedArr)
            // Can the system even show the permission screens on this device?
            var canRequest = false
            try {
                val i = Intent("android.healthconnect.action.REQUEST_PERMISSIONS")
                    .setPackage("com.google.android.apps.healthdata")
                canRequest = i.resolveActivity(io().packageManager) != null
            } catch (ignored: Throwable) {
            }
            d.put("canRequest", canRequest)
            var canManage = false
            try {
                val i = Intent("android.healthconnect.action.MANAGE_HEALTH_PERMISSIONS")
                canManage = i.resolveActivity(io().packageManager) != null
            } catch (ignored: Throwable) {
            }
            d.put("canManage", canManage)
            call.resolve(d)
        }
    }

    /** Camera self-diagnosis (permission + hardware). */
    @PluginMethod
    fun camDiag(call: PluginCall) {
        val d = JSObject()
        val granted = ContextCompat.checkSelfPermission(
            io(), android.Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        d.put("permGranted", granted)
        var hasCam = false
        try {
            hasCam = io().packageManager
                .hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)
        } catch (ignored: Throwable) {
        }
        d.put("hasCamera", hasCam)
        d.put("sdk", Build.VERSION.SDK_INT)
        call.resolve(d)
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
                    val bpm = recent.map { it.beatsPerMinute }.average()
                    data.put("bpm", Math.round(bpm))
                    data.put("at", samples.last().time.toEpochMilli())
                } else {
                    data.put("bpm", JSONObject.NULL)
                    data.put("at", JSONObject.NULL)
                }
            } catch (t: Throwable) {
                data.put("bpm", JSONObject.NULL)
                data.put("at", JSONObject.NULL)
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
                    metadata = Metadata.manualEntry(),
                    exerciseType = exerciseTypeFor(exerciseId),
                    title = "RepCoun · $exerciseId"
                )
                val active = ActiveCaloriesBurnedRecord(
                    startTime = start,
                    startZoneOffset = zone,
                    endTime = end,
                    endZoneOffset = zone,
                    energy = Energy.calories(kcal),
                    metadata = Metadata.manualEntry()
                )
                val total = TotalCaloriesBurnedRecord(
                    startTime = start,
                    startZoneOffset = zone,
                    endTime = end,
                    endZoneOffset = zone,
                    energy = Energy.calories(kcal),
                    metadata = Metadata.manualEntry()
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

    @PluginMethod
    fun setPipEnabled(call: PluginCall) {
        pipEnabled = call.getBoolean("enabled") ?: false
        call.resolve(JSObject())
    }

    @PluginMethod
    fun enterPip(call: PluginCall) {
        pipEnabled = true
        val act = activity as? MainActivity
        if (act != null) {
            act.runOnUiThread {
                val data = JSObject()
                data.put("ok", act.enterMiniMode())
                call.resolve(data)
            }
        } else {
            val data = JSObject()
            data.put("ok", false)
            call.resolve(data)
        }
    }

    @PluginMethod
    fun hcReadSessions(call: PluginCall) {
        executor.execute {
            val data = JSObject()
            val arr = com.getcapacitor.JSArray()
            var error: String? = null
            try {
                val days = (call.getInt("days") ?: 7).toLong()
                val client = HealthConnectClient.getOrCreate(io())
                val now = Instant.now()
                val since = now.minus(Duration.ofDays(days))
                val response = runBlocking {
                    client.readRecords(
                        ReadRecordsRequest(
                            recordType = ExerciseSessionRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(since, now)
                        )
                    )
                }
                for (s in response.records) {
                    val o = JSObject()
                    o.put("title", s.title ?: "")
                    o.put("startMs", s.startTime.toEpochMilli())
                    o.put("endMs", s.endTime.toEpochMilli())
                    o.put("durationSec", Duration.between(s.startTime, s.endTime).seconds)
                    o.put("app", appLabelFor(s.metadata.dataOrigin.packageName))
                    o.put("pkg", s.metadata.dataOrigin.packageName)
                    arr.put(o)
                }
            } catch (t: Throwable) {
                error = t.message ?: "read failed"
            }
            data.put("sessions", arr)
            data.put("ok", error == null)
            if (error != null) data.put("error", error)
            call.resolve(data)
        }
    }

    private fun appLabelFor(pkg: String): String = try {
        val pm = io().packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (t: Throwable) {
        pkg
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

        /** When the HC permission request was launched — detects a silently denied dialog. */
        @Volatile
        var hcRequestedAtMs: Long = 0L

        /** true while a workout is running — enables auto mini-mode on Home press */
        @Volatile
        var pipEnabled: Boolean = false

        val HC_PERMISSIONS: Set<String> = setOf(
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
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
         * Resolves the pending permission call when the standard dialog could not
         * be used: `manual=true` means Health Connect's own permissions screen was
         * opened so the user can grant access there instead.
         */
        @JvmStatic
        fun resolveHcManual(openedScreen: Boolean) {
            hcCall?.let { call ->
                hcCall = null
                val data = JSObject()
                data.put("granted", false)
                data.put("manual", openedScreen)
                call.resolve(data)
            }
        }

        @Volatile
        private var googleCall: PluginCall? = null

        /** Result of the native Google Sign-In dialog. */
        @JvmStatic
        fun handleGoogleResult(data: Intent?) {
            try {
                val task = GoogleSignIn.getSignedInAccountFromIntent(data)
                val account = task.getResult(ApiException::class.java)
                val d = JSObject()
                val token = account?.idToken
                if (token != null) {
                    d.put("idToken", token)
                    d.put("email", account.email ?: "")
                } else {
                    d.put("error", "no id token")
                }
                googleCall?.resolve(d)
            } catch (t: Throwable) {
                val d = JSObject()
                val msg = if (t is ApiException) {
                    when (t.statusCode) {
                        10 -> "Google setup error (code 10) — the SHA-1 fingerprint is missing in Firebase"
                        12500 -> "Google Play services is outdated — update it in the Play Store"
                        12501 -> "Google sign-in cancelled"
                        12502 -> "Google sign-in failed, try again"
                        else -> "Google error ${t.statusCode}"
                    }
                } else {
                    t.message ?: "google sign-in failed"
                }
                d.put("error", msg)
                googleCall?.resolve(d)
            }
            googleCall = null
        }

        @JvmStatic
        fun resolveGoogleError(msg: String) {
            val d = JSObject()
            d.put("error", msg)
            googleCall?.resolve(d)
            googleCall = null
        }

        /**
         * Map RepCoun exercise ids to Health Connect exercise types.
         * RepCoun tracks bodyweight/calisthenics movements, which is a dedicated
         * type in Health Connect (push-ups, squats, sit-ups, planks, …).
         */
        private fun exerciseTypeFor(id: String): Int =
            ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS
    }
}
