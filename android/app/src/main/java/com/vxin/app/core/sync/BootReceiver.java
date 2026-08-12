// BootReceiver.java
// =================
// Restart sync daemons after device reboot

package com.vxin.app.core.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.vxin.app.core.ui.WindowHelperService;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) return;

        try {
            Intent sync = new Intent(context, MessageSyncService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(sync);
            } else {
                context.startService(sync);
            }
        } catch (Exception ignored) {}

        try {
            Intent ui = new Intent(context, WindowHelperService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(ui);
            } else {
                context.startService(ui);
            }
        } catch (Exception ignored) {}
    }
}
