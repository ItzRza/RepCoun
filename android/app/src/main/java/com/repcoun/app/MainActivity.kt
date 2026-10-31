package com.repcoun.app

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Rational
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.contracts.HealthPermissionsRequestContract
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var cameraLauncher: ActivityResultLauncher<Array<String>>? = null
    private var hcLauncher: ActivityResultLauncher<Set<String>>? = null
    private var googleLauncher: ActivityResultLauncher<Intent>? = null
    private var notifLauncher: ActivityResultLauncher<Array<String>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // CRITICAL: the Capacitor bridge is created INSIDE super.onCreate(), so the
        // plugin must be added BEFORE it — registering afterwards silently does
        // nothing and every plugin call from JS fails as "not implemented".
        initialPlugins.add(RepCounPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Camera runtime permission (needed by the WebView camera / getUserMedia)
        cameraLauncher = activityResultRegistry.register(
            "repcoun.camera",
            ActivityResultContracts.RequestMultiplePermissions()
        ) { result ->
            RepCounPlugin.resolveCamera(result[Manifest.permission.CAMERA] == true)
        }

        // Health Connect permissions via the official 1.1.0 contract:
        // Set<String> in -> Set<String> granted out
        hcLauncher = activityResultRegistry.register(
            "repcoun.hc",
            HealthPermissionsRequestContract()
        ) { granted ->
            val elapsed = SystemClock.elapsedRealtime() - RepCounPlugin.hcRequestedAtMs
            if (granted.isEmpty() && elapsed < 1200) {
                // The result came back instantly with nothing granted — the
                // system never had time to SHOW the dialog, so it silently
                // denied it (blocked dialog / "don't ask again" / OEM policy).
                // Fall back to Health Connect's own permissions screen.
                RepCounPlugin.resolveHcManual(openHcPermissionsManually())
            } else {
                RepCounPlugin.resolveHc(granted.isNotEmpty())
            }
        }

        // Google Sign-In (native dialog — web popups are blocked in WebViews)
        googleLauncher = activityResultRegistry.register(
            "repcoun.google",
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            RepCounPlugin.handleGoogleResult(result.data)
        }

        // Wear OS wake-up notifications (Android 13+ runtime permission)
        notifLauncher = activityResultRegistry.register(
            "repcoun.notif",
            ActivityResultContracts.RequestMultiplePermissions()
        ) { /* best-effort — bridge works without notifications too */ }
    }

    /** Asks for the notification permission used by the watch wake-up tap. */
    fun launchNotifPermission() {
        try {
            notifLauncher?.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        } catch (t: Throwable) {
            // Older Android or blocked dialog — the bridge still works
        }
    }

    fun launchGoogleSignIn(intent: Intent) {
        try {
            googleLauncher?.launch(intent)
        } catch (t: Throwable) {
            RepCounPlugin.resolveGoogleError(t.message ?: "google sign-in failed")
        }
    }

    fun launchCameraPermission() {
        try {
            cameraLauncher?.launch(arrayOf(Manifest.permission.CAMERA))
        } catch (t: Throwable) {
            // Some devices block the system dialog — fail gracefully, no crash
            RepCounPlugin.resolveCamera(false)
        }
    }

    fun launchHcPermissions() {
        val launcher = hcLauncher
        if (launcher == null) {
            RepCounPlugin.resolveHcManual(openHcPermissionsManually())
            return
        }
        try {
            launcher.launch(RepCounPlugin.HC_PERMISSIONS)
        } catch (t: Throwable) {
            // The permission dialog failed to launch on this device — open
            // Health Connect's own permissions screen instead so the user can
            // grant access manually instead of hitting a silent dead end.
            RepCounPlugin.resolveHcManual(openHcPermissionsManually())
        }
    }

    /**
     * Opens Health Connect's permissions dashboard (works on Android 13 with the
     * Health Connect app and on Android 14+ with the built-in module).
     */
    private fun openHcPermissionsManually(): Boolean {
        return try {
            startActivity(Intent("android.healthconnect.action.MANAGE_HEALTH_PERMISSIONS"))
            true
        } catch (t: Throwable) {
            false
        }
    }

    /**
     * Mini mode: shrink RepCoun to a floating window so it keeps showing the
     * camera + rep counter on top of other workout apps (Home Workout, etc.).
     */
    fun enterMiniMode(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val params = PictureInPictureParams.Builder()
                    .setAspectRatio(Rational(9, 16))
                    .build()
                enterPictureInPictureMode(params)
                true
            } else {
                false
            }
        } catch (t: Throwable) {
            false
        }
    }

    /** Auto mini-mode when the user presses Home while a workout is running. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (RepCounPlugin.pipEnabled) {
            enterMiniMode()
        }
    }
}
