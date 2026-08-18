package com.touliao.app.core.crash

import android.app.Application
import android.os.Build
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * DEVICE-P1-001 专项：启动闪退诊断记录器。
 *
 * 在 Application 最早安全入口注册默认未捕获异常处理器，将脱敏信息写入
 * filesDir/startup-crash.log，方便无 adb 环境下回传诊断。
 *
 * 仅记录：时间 / App 版本 / Android 版本 / 设备 / 异常类 / message / stack trace。
 * 禁止记录：JWT、密码、R2/Firebase Secret、聊天内容等任何隐私数据。
 *
 * 不吞 crash：写盘后继续调用系统原始 UncaughtExceptionHandler，
 * 保证崩溃行为与之前完全一致（进程照常终止）。
 * 若崩溃是 native SIGSEGV/SIGABRT，本机制可能抓不到——属正常限制。
 */
object StartupCrashRecorder {

    private const val TAG = "StartupCrashRecorder"
    private const val FILE_NAME = "startup-crash.log"
    private const val MAX_BYTES = 200_000L

    @Volatile
    private var originalHandler: Thread.UncaughtExceptionHandler? = null

    /** 幂等安装；异常绝不阻断 Application 启动。 */
    fun install(app: Application) {
        runCatching {
            if (originalHandler != null) return // 已安装
            originalHandler = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                writeCrash(app, thread, throwable)
                // 交还系统原始处理器（不吞 crash）
                originalHandler?.uncaughtException(thread, throwable)
                    ?: run {
                        android.os.Process.killProcess(android.os.Process.myPid())
                        System.exit(10)
                    }
            }
            Log.i(TAG, "installed")
        }.onFailure {
            Log.w(TAG, "install failed: ${it.message}")
        }
    }

    private fun writeCrash(app: Application, thread: Thread, throwable: Throwable) {
        runCatching {
            val file = File(app.filesDir, FILE_NAME)
            val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
            val sb = StringBuilder()
            sb.append("=== startup crash @ ").append(ts).append(" ===").append('\n')
            val pkgInfo = app.packageManager.getPackageInfo(app.packageName, 0)
            sb.append("versionName=").append(pkgInfo.versionName).append('\n')
            sb.append("versionCode=").append(pkgInfo.versionCode).append('\n')
            sb.append("android=").append(Build.VERSION.RELEASE)
                .append(" (API ").append(Build.VERSION.SDK_INT).append(')').append('\n')
            sb.append("device=").append(Build.MANUFACTURER).append(' ')
                .append(Build.MODEL).append('\n')
            sb.append("thread=").append(thread.name).append('\n')
            sb.append("exception=").append(throwable.javaClass.name).append('\n')
            sb.append("message=").append(throwable.message?.take(500) ?: "(null)").append('\n')
            sb.append("stack:\n")
            throwable.stackTrace?.take(60)?.forEach { sb.append("  at ").append(it).append('\n') }
            var cause = throwable.cause
            var depth = 0
            while (cause != null && depth < 3) {
                sb.append("caused by: ").append(cause.javaClass.name).append(": ")
                    .append(cause.message?.take(300) ?: "(null)").append('\n')
                cause.stackTrace?.take(20)?.forEach { sb.append("  at ").append(it).append('\n') }
                cause = cause.cause
                depth++
            }
            sb.append('\n')
            file.appendText(sb.toString())
            // 限制文件体积，防止长期膨胀（保留最近约 400 行）
            if (file.length() > MAX_BYTES) {
                val lines = file.readLines()
                if (lines.size > 400) {
                    file.writeText(lines.takeLast(400).joinToString("\n") + "\n")
                }
            }
            Log.i(TAG, "crash recorded -> ${file.absolutePath}")
        }.onFailure {
            Log.w(TAG, "write failed: ${it.message}")
        }
    }
}
