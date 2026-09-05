package com.touliao.app.core.capture

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.touliao.app.MainActivity
import com.touliao.app.core.push.NotificationHelper
import java.io.File
import java.io.FileOutputStream

/**
 * 全屏截图前台服务：
 * 1. 以 mediaProjection 类型起前台（Android 14+ 硬性要求，且必须先起前台再取 MediaProjection）。
 * 2. 悬浮一个「截屏」小球，用户可切到任意 App，点小球截当前整屏。
 * 3. 用 MediaProjection + VirtualDisplay + ImageReader 抓一帧 → 存 PNG 到 cache/screenshot →
 *    通过 ScreenCaptureBus 发给发起方 ViewModel（去发送），并把 投聊 拉回前台。
 * 4. 截完即停：释放投影/虚拟屏/悬浮窗，撤前台。
 *
 * 权限：需 FOREGROUND_SERVICE_MEDIA_PROJECTION + SYSTEM_ALERT_WINDOW（悬浮球）。
 * 用户在系统「录屏/投影」授权框点允许后，data 通过 Intent 传入本服务。
 */
class ScreenCaptureService : Service() {

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopEverything(); return START_NOT_STICKY }
        }
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, android.app.Activity.RESULT_CANCELED)
            ?: android.app.Activity.RESULT_CANCELED
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)
        }
        if (resultCode != android.app.Activity.RESULT_OK || data == null) {
            stopEverything(); return START_NOT_STICKY
        }

        // 必须先起前台（mediaProjection 类型），再取 MediaProjection（Android 14+ 强制顺序）
        startAsForeground()

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(resultCode, data)?.also { mp ->
            // Android 14+：MediaProjection 需注册回调，否则 stop 时可能告警
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { /* 系统侧停止投影 */ }
            }, handler)
        }
        if (projection == null) { stopEverything(); return START_NOT_STICKY }

        showFloatingButton()
        return START_NOT_STICKY
    }

    // ── 悬浮「截屏」小球 ───────────────────────────────────
    private fun showFloatingButton() {
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val ball = TextView(this).apply {
            text = "截屏"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
            setBackgroundColor(0xCC6D5AE6.toInt())
            setPadding(28, 28, 28, 28)
        }
        val container = FrameLayout(this).apply { addView(ball) }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 40; y = 240
        }
        // 拖动 + 点击：短按截屏，拖动移动位置
        var downX = 0f; var downY = 0f; var lpX = 0; var lpY = 0; var moved = false
        ball.setOnTouchListener { _, ev ->
            when (ev.action) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX; downY = ev.rawY; lpX = lp.x; lpY = lp.y; moved = false; true
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downX).toInt(); val dy = (ev.rawY - downY).toInt()
                    if (kotlin.math.abs(dx) > 12 || kotlin.math.abs(dy) > 12) moved = true
                    lp.x = lpX - dx; lp.y = lpY + dy
                    runCatching { windowManager?.updateViewLayout(container, lp) }; true
                }
                android.view.MotionEvent.ACTION_UP -> {
                    if (!moved) { hideFloatingButton(); handler.postDelayed({ captureOneFrame() }, 180) }
                    true
                }
                else -> false
            }
        }
        floatingView = container
        runCatching { windowManager?.addView(container, lp) }
    }

    private fun hideFloatingButton() {
        floatingView?.let { v -> runCatching { windowManager?.removeView(v) } }
        floatingView = null
    }

    // ── 抓一帧 ─────────────────────────────────────────────
    private fun captureOneFrame() {
        val mp = projection ?: run { stopEverything(); return }
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        virtualDisplay = mp.createVirtualDisplay(
            "vxin-capture",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface, null, handler,
        )

        // 给一帧渲染时间再取图
        reader.setOnImageAvailableListener({ ir ->
            val image = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val planes = image.planes
                val buffer = planes[0].buffer
                val pixelStride = planes[0].pixelStride
                val rowStride = planes[0].rowStride
                val rowPadding = rowStride - pixelStride * width
                val bmp = Bitmap.createBitmap(
                    width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888,
                )
                bmp.copyPixelsFromBuffer(buffer)
                // 裁掉行填充
                val cropped = Bitmap.createBitmap(bmp, 0, 0, width, height)
                bmp.recycle()
                saveAndEmit(cropped)
            } catch (_: Throwable) {
                // 静默失败：直接收尾
            } finally {
                image.close()
                handler.post { stopEverything() }
            }
        }, handler)
    }

    private fun saveAndEmit(bitmap: Bitmap) {
        runCatching {
            val dir = File(cacheDir, "screenshot").apply { mkdirs() }
            // 固定单文件避免堆积
            val file = File(dir, "screen_${System.currentTimeMillis()}.png")
            FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
            bitmap.recycle()
            ScreenCaptureBus.emit(file)
            // 把 投聊 拉回前台，让用户看到截图已发送
            startActivity(Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            })
        }
    }

    // ── 前台通知 ───────────────────────────────────────────
    private fun startAsForeground() {
        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, ScreenCaptureService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, NotificationHelper.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("截屏进行中")
            .setContentText("点悬浮「截屏」按钮抓当前整屏并发送")
            .setOngoing(true)
            .addAction(0, "取消", stopIntent)
            .build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        runCatching {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        }
    }

    private fun stopEverything() {
        hideFloatingButton()
        runCatching { virtualDisplay?.release() }; virtualDisplay = null
        runCatching { imageReader?.close() }; imageReader = null
        runCatching { projection?.stop() }; projection = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopEverything()
    }

    companion object {
        private const val NOTIFICATION_ID = 424244   // 与来电(424242)/通话(424243)分开
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        const val ACTION_STOP = "com.touliao.app.capture.STOP"

        fun startIntent(context: Context, resultCode: Int, data: Intent): Intent =
            Intent(context, ScreenCaptureService::class.java).apply {
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_DATA, data)
            }
    }
}
