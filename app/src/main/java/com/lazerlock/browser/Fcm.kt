package com.lazerlock.browser

import android.content.Context

/**
 * Firebase Cloud Messaging: instant "sync now" wake-ups so a new message (or any change) shows at once, even with
 * the app closed. The push carries only a ping — never the message text — so the content stays sealed in GitHub and
 * is fetched over the app's normal encrypted channel when it wakes. Firebase is OPTIONAL: without google-services.json
 * (and the backend's FCM secret) none of this runs, and the app falls back to its ~15-minute background check and
 * sync-on-open. Every Firebase call here is guarded so the app works with or without it. See FCM-SETUP.md.
 */
object Fcm {
    private const val PREFS = "fcm"

    /** True only when Firebase was actually configured into this build (google-services.json was present). */
    fun available(ctx: Context): Boolean = runCatching { com.google.firebase.FirebaseApp.getApps(ctx).isNotEmpty() }.getOrDefault(false)

    /** The current token (for the admin app, which registers through its web page). "" if none yet. */
    fun token(ctx: Context): String = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", "") ?: ""

    /** On app start: make sure there's a token, store it, and (browser app) register it with the backend. */
    fun register(ctx: Context) {
        if (!available(ctx)) return
        runCatching {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
                if (t.isSuccessful) t.result?.let { store(ctx, it) } else AppLog.w("Push", "No push token: ${t.exception?.message}")
            }
        }.onFailure { AppLog.w("Push", "Couldn't ask for a push token: ${it.message}") }
    }

    fun onNewToken(ctx: Context, token: String) = store(ctx, token)

    private fun store(ctx: Context, token: String) {
        if (token.isBlank()) return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val changed = p.getString("token", "") != token
        p.edit().putString("token", token).apply()
        // The browser app registers the token itself (sealed, like a request). The admin app registers through its
        // web page (AdminActivity reads token() and hands it to the page, which sends the signed 'fcmtoken' command).
        if (!BuildConfig.ADMIN_APP) {
            val lastSent = p.getLong("sentAt", 0L)
            if (changed || System.currentTimeMillis() - lastSent > 7L * 86_400_000L) Thread {
                runCatching { Requests.queueFcmToken(ctx, token); Outbox.flush(ctx) }
                p.edit().putLong("sentAt", System.currentTimeMillis()).apply()
            }.start()
        }
    }

    /** A wake-up push arrived: sync in the background so new messages/changes are ready, and notify if the app is closed. */
    fun onPing(ctx: Context) {
        Thread {
            runCatching {
                AppLog.ready(ctx)
                runCatching { TrustedTime.init(ctx) }
                Whitelist.loadCache(ctx)
                if (!BuildConfig.ADMIN_APP) {
                    runCatching { Whitelist.refresh(ctx, eager = true) }
                    runCatching { Outbox.flush(ctx) }
                    runCatching { notifyNewMessages(ctx) }
                }
                runCatching { AdminAlerts.check(ctx) }   // admin phones / admin app: request + message notifications
            }.onFailure { AppLog.e("Push", "Sync after a push failed", it) }
        }.start()
    }

    /** Browser app: a plain heads-up if a new admin message arrived while the app was closed. */
    private fun notifyNewMessages(ctx: Context) {
        val threads = runCatching { org.json.JSONArray(Whitelist.state.threads.ifBlank { "[]" }) }.getOrNull() ?: return
        var newest = 0L
        for (i in 0 until threads.length()) {
            val ms = threads.optJSONObject(i)?.optJSONArray("msgs") ?: continue
            for (j in 0 until ms.length()) {
                val o = ms.optJSONObject(j) ?: continue
                if (o.optString("who") == "admin" && !o.optBoolean("del", false)) newest = maxOf(newest, parseIso(o.optString("at")))
            }
        }
        if (newest <= 0L) return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (p.getLong("notifiedMsgAt", 0L) >= newest) return
        p.edit().putLong("notifiedMsgAt", newest).apply()
        // If the app is on screen, its own heads-up handles it — don't double up.
        if (System.currentTimeMillis() - p.getLong("fgAt", 0L) < 60_000L) return
        AdminAlerts.notifyMessage(ctx, "New message", "Open to read it")
    }

    private fun parseIso(s: String): Long = runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.parse(s.take(19))?.time ?: 0L
    }.getOrDefault(0L)

    /** Activities mark when they're on screen, so a push doesn't post a notification over the open app. */
    fun markForeground(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("fgAt", if (on) System.currentTimeMillis() else 0L).apply()
    }
}

/** Receives Firebase pushes. Present only matters when Firebase is configured; otherwise it's never called. */
class WlbMessaging : com.google.firebase.messaging.FirebaseMessagingService() {
    override fun onNewToken(token: String) { runCatching { Fcm.onNewToken(applicationContext, token) } }
    override fun onMessageReceived(message: com.google.firebase.messaging.RemoteMessage) { runCatching { Fcm.onPing(applicationContext) } }
}
