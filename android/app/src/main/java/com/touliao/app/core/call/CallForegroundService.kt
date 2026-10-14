package com.touliao.app.core.call

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.touliao.app.R
import com.touliao.app.core.push.CallActionReceiver
import com.touliao.app.core.push.NotificationHelper
import com.touliao.app.feature.call.CallActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 通话保活前台服务：通话建立本地媒体（开始采集麦克风）后启动，展示一条"通话中"常驻通知，
 * 使进程在熄屏 / Doze 下不被系统回收导致通话中断。
 *
 * - foregroundServiceType：microphone（视频通话再叠加 camera），与 WebRTC 采集对齐（合规要求）。
 * - 生命周期：CallManager / GroupCallManager 建流且 RECORD_AUDIO 已授权后 [start]，cleanup 处 [stop]。
 *   1v1 和群通话共用本服务，按 [Owner] 计数：所有 owner 都 stop 之后才真正停止，交替时不会互相撤掉。
 * - startForeground 失败（权限缺失/后台限制）必须 stopSelf()：startForegroundService 发出后服务若既
 *   不进前台也不停止，系统到时抛 ForegroundServiceDidNotStartInTimeException 直接崩进程。
 * - 不承载信令 / 媒体本身，仅承载前台态；无需 bind。
 * - [running] 只在 startForeground 真正成功后为 true：App 在后台时 startForegroundService/startForeground
 *   会被系统拒绝（Android 12+ 后台启动限制、Android 14 microphone 类型需 while-in-use），调用方据此
 *   在回到前台时补起，否则整通电话在后台都被系统静音麦克风（对方听不见）。
 *
 * "通话中"通知（CALL-6）：独立的低重要性渠道（不响不振不弹横幅），CallStyle 显示对方名字 / 群名、
 * 状态文字、接通后计时和"挂断"按钮；点正文回到 CallActivity。startForeground 只调一次，之后观察
 * 两路通话状态和群名单，内容变化时用同一个 id notify 更新；两路都结束时 stopSelf。
 */
@AndroidEntryPoint
class CallForegroundService : Service() {

    /** 前台服务的使用方：1v1 与群通话各算一个，全部 stop 后才停止服务。 */
    enum class Owner { P2P, GROUP }

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var groupCallManager: GroupCallManager
    @Inject lateinit var roster: GroupCallRoster
    // 注入只为确保通知渠道（含"通话中"渠道）已创建：NotificationHelper 在 init 里建渠道
    @Inject lateinit var notificationHelper: NotificationHelper

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var observeJob: Job? = null
    private var lastStartId = 0
    private var lastModel: OngoingCallModel? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false

        // API 34+(U) 必须显式传 foregroundServiceType；用 ServiceCompat 兼容旧版本。
        // camera 类型只在已授权 CAMERA 时叠加（Android 14 未授权叠加会抛 SecurityException）
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video && hasPermission(this, android.Manifest.permission.CAMERA)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            t
        } else {
            0
        }
        val model = ongoingModelOf(callManager.state.value, groupCallManager.state.value, roster.state.value)
            ?: OngoingCallModel.placeholder(video)
        // 本实例此前是否已进入前台（另一路通话先启动过本服务）
        val wasRunning = running
        runCatching {
            try {
                ServiceCompat.startForeground(this, CallIntents.ONGOING_CALL_NOTIFICATION_ID, build(model, callStyle = true), type)
            } catch (e: IllegalArgumentException) {
                // CallStyle 被系统拒绝时降级为普通样式 + "挂断"按钮
                android.util.Log.w(TAG, "CallStyle 通知被拒，降级为普通样式: ${e.message}")
                ServiceCompat.startForeground(this, CallIntents.ONGOING_CALL_NOTIFICATION_ID, build(model, callStyle = false), type)
            }
        }.onSuccess {
            running = true
            lastModel = model
        }.onFailure { e ->
            if (wasRunning) {
                // 已在前台时再次 start（另一路通话加入、或要追加 camera 类型）失败，例如 Android 14 在后台
                // 追加 camera 类型被拒：保持原来的前台状态继续保活，不能把正在进行的另一路通话一起停掉。
                // 服务已在前台时系统不会再要求本次 startForegroundService 补调 startForeground，不会超时崩溃。
                android.util.Log.w(TAG, "startForeground 刷新失败，保持原前台状态: ${e.message}")
            } else {
                android.util.Log.w(TAG, "startForeground 失败，停止服务: ${e.message}")
                running = false
                stopSelf()
            }
        }

        if (running && observeJob == null) {
            observeJob = scope.launch {
                combine(callManager.state, groupCallManager.state, roster.state) { c, g, r -> ongoingModelOf(c, g, r) }
                    .distinctUntilChanged()
                    .collect { m ->
                        if (!running) return@collect
                        if (m == null) {
                            // 两路都已结束：停止服务（startId 不是最新的说明又有新的 start，系统不会停）
                            stopSelf(lastStartId)
                            return@collect
                        }
                        if (m != lastModel) {
                            post(m)
                            lastModel = m
                        }
                    }
            }
        }
        // 被系统杀掉不自动重建（通话已断，重建无意义）
        return START_NOT_STICKY
    }

    /** 用同一个 id 更新"通话中"通知；CallStyle 被拒（IllegalArgumentException）时降级为普通样式。 */
    private fun post(m: OngoingCallModel) {
        val nm = NotificationManagerCompat.from(this)
        try {
            try {
                nm.notify(CallIntents.ONGOING_CALL_NOTIFICATION_ID, build(m, callStyle = true))
            } catch (e: IllegalArgumentException) {
                android.util.Log.w(TAG, "CallStyle 通知更新被拒，降级为普通样式: ${e.message}")
                nm.notify(CallIntents.ONGOING_CALL_NOTIFICATION_ID, build(m, callStyle = false))
            }
        } catch (_: SecurityException) {
            // 通知权限被收回，忽略
        } catch (e: IllegalArgumentException) {
            android.util.Log.w(TAG, "通话中通知更新失败: ${e.message}")
        }
    }

    override fun onDestroy() {
        scope.cancel()
        running = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        NotificationManagerCompat.from(this).cancel(CallIntents.ONGOING_CALL_NOTIFICATION_ID)
        super.onDestroy()
    }

    /**
     * 构建"通话中"通知。[callStyle] 为 true 时用 CallStyle（系统自带"挂断"按钮），
     * 否则用普通样式并手动加一个"挂断"按钮。
     */
    private fun build(m: OngoingCallModel, callStyle: Boolean): Notification {
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // 点正文：回到 CallActivity（它可越过锁屏，锁屏上无需先解锁）
        val resume = PendingIntent.getActivity(
            this, CallIntents.REQ_ONGOING_RESUME,
            CallActivity.intent(this, CallIntents.ACTION_CALL_RESUME).setData(Uri.parse("touliao://call-ongoing/resume")),
            piFlags,
        )
        // 挂断：广播给不导出的接收器，带 callKind + callId 防止旧通知挂掉新的一通
        val hangup = PendingIntent.getBroadcast(
            this, CallIntents.REQ_ONGOING_HANGUP,
            Intent(this, CallActionReceiver::class.java)
                .setAction(CallIntents.ACTION_CALL_HANGUP)
                .setData(Uri.parse("touliao://call-ongoing/hangup"))
                .putExtra(CallIntents.EXTRA_CALL_KIND, m.kind)
                .putExtra(CallIntents.EXTRA_CALL_ID, m.callId)
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND),
            piFlags,
        )
        val builder = NotificationCompat.Builder(this, CallIntents.CALL_ONGOING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(m.title)
            .setContentText(m.text)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(resume)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (m.connectedAtElapsed > 0) {
            // 接通时刻是 elapsedRealtime 口径，换算成墙钟时间交给系统计时器
            builder.setUsesChronometer(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis() - (SystemClock.elapsedRealtime() - m.connectedAtElapsed))
        } else {
            builder.setShowWhen(false)
        }
        if (callStyle) {
            val person = Person.Builder().setName(m.title).setImportant(true).build()
            builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangup).setIsVideo(m.isVideo))
        } else {
            builder.addAction(0, "挂断", hangup)
        }
        return builder.build()
    }

    companion object {
        private const val TAG = "CallForegroundService"
        private const val EXTRA_VIDEO = "video"

        /** 各 owner 当前是否为视频通话；所有访问都在 synchronized(owners) 内。 */
        private val owners = java.util.EnumMap<Owner, Boolean>(Owner::class.java)

        /** 服务是否已真正进入前台（startForeground 成功）；被拒/已停为 false。 */
        @Volatile @JvmStatic var running: Boolean = false
            private set

        private fun hasPermission(context: Context, permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED

        /** microphone 类型 FGS 的前提：RECORD_AUDIO 已授权。 */
        fun hasRecordAudioPermission(context: Context): Boolean =
            hasPermission(context, android.Manifest.permission.RECORD_AUDIO)

        /**
         * RECORD_AUDIO 已授权后调用（未授权直接跳过，由调用方授权后再调）。
         * 记下 [owner]，任一 owner 是视频通话就按视频申请 camera 类型。
         * 返回请求是否发出：后台被拒（ForegroundServiceStartNotAllowedException 等）返回 false，并撤销该 owner。
         * 发出后 startForeground 仍可能在服务内失败，以 [running] 为准。
         */
        fun start(context: Context, video: Boolean, owner: Owner): Boolean {
            if (!hasRecordAudioPermission(context)) return false
            val anyVideo = synchronized(owners) {
                owners[owner] = video
                owners.values.any { it }
            }
            val intent = Intent(context, CallForegroundService::class.java).putExtra(EXTRA_VIDEO, anyVideo)
            val ok = runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { e -> android.util.Log.w(TAG, "startForegroundService 被拒: ${e.message}") }
                .isSuccess
            if (!ok) synchronized(owners) { owners.remove(owner) }
            return ok
        }

        /** 通话结束（cleanup）时调用；幂等。所有 owner 都 stop 后才真正停止服务。 */
        fun stop(context: Context, owner: Owner) {
            // stopService 也放在锁内，与 start 的登记串行：否则"这边刚判定为空、另一路恰好登记并发出启动"时，
            // 这里迟到的 stopService 会把另一路刚启动的服务停掉
            synchronized(owners) {
                owners.remove(owner)
                if (owners.isNotEmpty()) return
                runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
            }
        }
    }
}
