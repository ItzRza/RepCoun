package com.repcoun.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Watch side of the RepCoun bridge (Wear OS Data Layer) + a tiny local event
 * bus so the workout service and the UI can talk without bindings.
 *
 * Phone → watch: config / state / ack   (emitted locally as the same names)
 * Watch → phone: start / stop / rep / hr / auto / hello
 */
object WatchLink {

    private const val MSG_PREFIX = "/repcoun/"
    private const val PREFS = "repcoun"

    private var appContext: Context? = null
    private val callbacks = CopyOnWriteArrayList<(String, JSONObject) -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    /** config from the phone: {mode, autoDetect} — persisted across restarts. */
    @Volatile
    var config: JSONObject = JSONObject()

    @Volatile
    var connected: Boolean = false

    @Volatile
    var nodeName: String = ""

    @Volatile
    private var started = false

    private val messageListener = MessageClient.OnMessageReceivedListener { event ->
        val path = event.path
        if (path.startsWith(MSG_PREFIX)) {
            val name = path.removePrefix(MSG_PREFIX)
            val data = try {
                JSONObject(String(event.data, Charsets.UTF_8))
            } catch (t: Throwable) {
                JSONObject()
            }
            if (name == "config") {
                config = data
                try {
                    appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        ?.edit()?.putString("config", data.toString())?.apply()
                } catch (t: Throwable) {
                }
            }
            emitLocal(name, data)
        }
    }

    fun init(context: Context) {
        if (started) return
        started = true
        appContext = context.applicationContext
        try {
            val raw = context.applicationContext
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString("config", null)
            if (raw != null) config = JSONObject(raw)
        } catch (t: Throwable) {
        }
        try {
            Wearable.getMessageClient(context).addListener(messageListener)
                .addOnFailureListener { }
        } catch (t: Throwable) {
            // No Play services — the watch works standalone
        }
        // hello tells the phone we exist (it answers with config)
        send("hello", JSONObject().put("app", "repcoun").put("ts", System.currentTimeMillis()))
        checkOnce()
    }

    /** Local subscription (service ↔ activity). Returns an unsubscribe fn. */
    fun subscribe(cb: (String, JSONObject) -> Unit): () -> Unit {
        callbacks.add(cb)
        return { callbacks.remove(cb) }
    }

    /** Fire a local event on the UI thread (never leaves the watch). */
    fun emitLocal(path: String, data: JSONObject) {
        main.post {
            for (cb in callbacks) {
                try {
                    cb(path, data)
                } catch (t: Throwable) {
                }
            }
        }
    }

    /** Send a message to the phone (fire and forget, background thread). */
    fun send(name: String, data: JSONObject) {
        val ctx = appContext ?: return
        Thread {
            try {
                val nodes = Wearable.getNodeClient(ctx).connectedNodes.result
                val bytes = data.toString().toByteArray(Charsets.UTF_8)
                for (node in nodes) {
                    try {
                        Wearable.getMessageClient(ctx)
                            .sendMessage(node.id, MSG_PREFIX + name, bytes)
                    } catch (t: Throwable) {
                    }
                }
            } catch (t: Throwable) {
            }
        }.start()
    }

    /** Re-check the phone connection (driven by the UI ticker). */
    fun checkOnce() {
        val ctx = appContext ?: return
        try {
            Wearable.getNodeClient(ctx).connectedNodes
                .addOnSuccessListener { nodes ->
                    val node = nodes.firstOrNull()
                    val now = node != null
                    val name = node?.displayName ?: ""
                    if (now != connected || name != nodeName) {
                        connected = now
                        nodeName = name
                        emitLocal("conn", JSONObject().put("connected", now).put("name", name))
                    }
                }
                .addOnFailureListener { }
        } catch (t: Throwable) {
        }
    }
}
