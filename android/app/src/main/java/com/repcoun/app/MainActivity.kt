package com.repcoun.app

import android.Manifest
import android.app.PictureInPictureParams
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.contracts.HealthPermissionsRequestContract
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var cameraLauncher: ActivityResultLauncher<Array<String>>? = null
    private var hcLauncher: ActivityResultLauncher<Set<String>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Custom plugin: camera permission + Health Connect + mini mode
        registerPlugin(RepCounPlugin::class.java)

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
            RepCounPlugin.resolveHc(granted.isNotEmpty())
        }
    }

    fun launchCameraPermission() {
        cameraLauncher?.launch(arrayOf(Manifest.permission.CAMERA))
    }

    fun launchHcPermissions() {
        hcLauncher?.launch(RepCounPlugin.HC_PERMISSIONS)
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
