package com.repcoun.app

import android.Manifest
import android.os.Bundle
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.permission.PermissionController
import androidx.health.connect.client.permission.RequestPermissionsRequestOptions
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var cameraLauncher: ActivityResultLauncher<Array<String>>? = null
    private var hcLauncher: ActivityResultLauncher<Array<String>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Custom plugin: camera permission + Health Connect
        registerPlugin(RepCounPlugin::class.java)

        // Camera runtime permission (needed by the WebView camera / getUserMedia)
        cameraLauncher = activityResultRegistry.register(
            "repcoun.camera",
            ActivityResultContracts.RequestMultiplePermissions()
        ) { result ->
            RepCounPlugin.resolveCamera(result[Manifest.permission.CAMERA] == true)
        }

        // Health Connect permissions through the official contract
        try {
            val options = RequestPermissionsRequestOptions.Builder()
                .setPermissionIds(ArrayList(RepCounPlugin.HC_PERMISSIONS))
                .build()
            val contract = PermissionController.createRequestPermissionContract(options)
            hcLauncher = activityResultRegistry.register("repcoun.hc", contract) { result ->
                val granted = result.isNotEmpty() && result.values.all { it }
                RepCounPlugin.resolveHc(granted)
            }
        } catch (t: Throwable) {
            // Health Connect not present on this device — handled gracefully in JS
        }
    }

    fun launchCameraPermission() {
        cameraLauncher?.launch(arrayOf(Manifest.permission.CAMERA))
    }

    fun launchHcPermissions() {
        hcLauncher?.launch(arrayOf())
    }
}
