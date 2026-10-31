package com.repcoun.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Phone side of the RepCoun watch bridge (Wear OS Data Layer).
 *
 * The watch app ships with the SAME package id and signing key, so Google
 * Play Services pairs both apps through the normal phone ↔ watch companion
 * bond automatically — no extra pairing code is needed.
 *
 * Commands that arrive while the phone app is closed are parked in [pending]
 * and woken up with a tap notification; wearInit / handleOnResume delivers them.
 */
class WearBridge(
    private val context: Context,
    private val onEvent: (name: String, data: JSONObject, retained: Boolean) -> Unit,
    private val onStatus: (connected: Boolean, node: String) -> Unit
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    @Volatile
    var running = false

    /** true while the phone app is on screen — direct delivery vs notification. */
    @Volatile
    var foreground = false

    /** from settings: wake the phone when the watch detects a workout. */
    @Volatile
    var autoOpen = false

    @Volatile
    private var lastNodeId: String? = null

    @Volatile
    private var lastNodeName: String = ""

    @Volatile
    private var lastConnected: Boolean? = null

    val isConnected: Boolean get() = lastConnected == true
    val nodeName: String get() = lastNodeName

    private val messageListener = MessageClient.OnMessageReceivedListener { event ->
        val path = event.path
        if (path.startsWith(MSG_PREFIX)) {
            val name = path.removePrefix(MSG_PREFIX)
            val data = try {
                JSONObject(String(event.data, Charsets.UTF_8))
            } catch (t: Throwable) {
                JSONObject()
            }
            main.post { dispatch(name, data) }
        }
    }

    private fun dispatch(name: String, data: JSONObject) {
        if (!running) return
        when (name) {
            "start", "auto", "stop" -> {
                if (name == "auto" && !autoOpen) return
                if (foreground) {
                    onEvent(name, data, true)
                } else {
                    // App closed / backgrounded — park the command and tap-wake.
                    pending = JSONObject().put("name", name).put("data", data)
                    notifyPhone(
                        if (name == "auto") "Watch detected a workout" else "Start from your watch",
                        if (name == "auto") "RepCoun can start counting — tap to open"
                        else "Tap to open RepCoun and start counting"
                    )
                }
            }
            else -> onEvent(name, data, false) // rep / hr / hello — fire and forget
        }
    }

    fun start() {
        if (running) return
        running = true
        try {
            Wearable.getMessageClient(context).addListener(messageListener)
                .addOnFailureListener { }
        } catch (t: Throwable) {
            // Play services missing — bridge stays idle
        }
        pollNodes()
        main.postDelayed(poller, POLL_MS)
    }

    fun stop() {
        running = false
        main.removeCallbacks(poller)
        try {
            Wearable.getMessageClient(context).removeListener(messageListener)
        } catch (t: Throwable) {
        }
        lastConnected = null
        lastNodeId = null
        lastNodeName = ""
    }

    private val poller = object : Runnable {
        override fun run() {
            if (!running) return
            pollNodes()
            main.postDelayed(this, POLL_MS)
        }
    }

    private fun pollNodes() {
        try {
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    if (!running) return@addOnSuccessListener
                    val node = nodes.firstOrNull()
                    val connected = node != null
                    if (node?.id != lastNodeId || connected != lastConnected) {
                        lastNodeId = node?.id
                        lastNodeName = node?.displayName ?: ""
                        lastConnected = connected
                        onStatus(connected, lastNodeName)
                    }
                }
                .addOnFailureListener { }
        } catch (t: Throwable) {
        }
    }

    /** Send a message to every connected watch (call from a background thread). */
    fun send(name: String, data: JSONObject) {
        io.execute {
            try {
                val nodes = Wearable.getNodeClient(context).connectedNodes.result
                val bytes = data.toString().toByteArray(Charsets.UTF_8)
                for (node in nodes) {
                    try {
                        Wearable.getMessageClient(context)
                            .sendMessage(node.id, MSG_PREFIX + name, bytes)
                    } catch (t: Throwable) {
                        // this node vanished mid-send — the others still get it
                    }
                }
            } catch (t: Throwable) {
            }
        }
    }

    private fun notifyPhone(title: String, text: String) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel("watch", "Smartwatch", NotificationManager.IMPORTANCE_HIGH)
                )
            }
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pi = PendingIntent.getActivity(
                context, 7701, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = Notification.Builder(context, "watch")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build()
            nm.notify(7700, notification)
        } catch (t: Throwable) {
            // Notifications blocked (permission denied) — the pending command is
            // still delivered the next time the app opens.
        }
    }

    companion object {
        const val MSG_PREFIX = "/repcoun/"
        private const val POLL_MS = 5000L

        /** start/stop that arrived while the app was closed — consumed by wearInit/resume. */
        @Volatile
        var pending: JSONObject? = null

        fun takePending(): JSONObject? {
            val p = pending
            pending = null
            return p
        }
    }
}
