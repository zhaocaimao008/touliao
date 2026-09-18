import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Looper;
import dalvik.system.DexClassLoader;
import java.io.File;
import java.lang.reflect.Method;

/** Native framework regression using the actual old/new APK's verifier classes.
 * Test helper only: not packaged in the app, never changes a verifier or key.
 */
public final class ApkSignatureCompatProbe {
    static Object verifier(String apk, Context context, File optimized) throws Exception {
        DexClassLoader loader = new DexClassLoader(apk, optimized.getPath(), null,
                ApkSignatureCompatProbe.class.getClassLoader());
        return loader.loadClass("com.touliao.app.core.update.ApkInstaller")
                .getConstructor(Context.class).newInstance(context);
    }
    static boolean matches(Object verifier, String apk) throws Exception {
        return (Boolean) verifier.getClass().getMethod("isSignatureMatch", File.class)
                .invoke(verifier, new File(apk));
    }
    public static void main(String[] args) throws Exception {
        if (Looper.myLooper() == null) Looper.prepareMainLooper();
        Class<?> thread = Class.forName("android.app.ActivityThread");
        Object activityThread = thread.getMethod("systemMain").invoke(null);
        Method systemContext = thread.getDeclaredMethod("getSystemContext");
        systemContext.setAccessible(true);
        Context base = (Context) systemContext.invoke(activityThread);
        Context context = new ContextWrapper(base) {
            @Override public String getPackageName() { return "com.touliao.app"; }
            @Override public Context getApplicationContext() { return this; }
        };
        File optimized = new File("/data/local/tmp/touliao-compat-probe");
        optimized.mkdirs();
        Object old = verifier(args[0], context, optimized);
        Object fixed = verifier(args[1], context, optimized);
        PackageManager pm = context.getPackageManager();
        PackageInfo oldFlags = pm.getPackageArchiveInfo(args[1], PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo bothFlags = pm.getPackageArchiveInfo(args[1],
                PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES);
        boolean oldResult = matches(old, args[1]);
        boolean fixedResult = matches(fixed, args[1]);
        boolean tamperedResult = matches(fixed, args[2]);
        boolean oldFlagsNull = oldFlags != null && oldFlags.signingInfo == null;
        boolean bothFlagsPresent = bothFlags != null && bothFlags.signingInfo != null;
        System.out.println("{\"environment\":\"API 29 native framework; actual compiled verifier classes\","
            + "\"oldFlagsSigningInfoNull\":" + oldFlagsNull + ",\"bothFlagsSigningInfoPresent\":" + bothFlagsPresent
            + ",\"oldVerifierAcceptedSameSigner\":" + oldResult + ",\"fixedVerifierAcceptedSameSigner\":" + fixedResult
            + ",\"fixedVerifierAcceptedTamperedApk\":" + tamperedResult + ",\"physicalDevice\":false}");
        // The currently published baseline will eventually contain this fix too.
        // Record its behavior, but do not require a future baseline to stay broken.
        if (!oldFlagsNull || !bothFlagsPresent || !fixedResult || tamperedResult) {
            throw new AssertionError("API 29 certificate compatibility regression failed");
        }
    }
}
