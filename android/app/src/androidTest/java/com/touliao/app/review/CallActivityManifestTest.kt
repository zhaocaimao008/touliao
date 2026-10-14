package com.touliao.app.review

import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.touliao.app.MainActivity
import com.touliao.app.feature.call.CallActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * CALL-2 锁屏不变量：只有通话页（CallActivity）能越过锁屏，MainActivity 在清单里绝不能有越过锁屏 / 亮屏能力；
 * 通话页也不在清单里声明亮屏（只在响铃时由代码动态打开），并且是不导出、singleTask、独立任务。
 * 只读 PackageManager 解析出的清单信息，不启动任何 Activity，不需要 Hilt。
 */
@RunWith(AndroidJUnit4::class)
class CallActivityManifestTest {

    @Suppress("DEPRECATION")
    @Test
    fun onlyCallActivityMayShowOverLockscreen() {
        // 清单属性从 API 27 起才解析进 ActivityInfo.flags
        assumeTrue(Build.VERSION.SDK_INT >= 27)
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val pm = ctx.packageManager
        val main = pm.getActivityInfo(ComponentName(ctx, MainActivity::class.java), 0)
        val call = pm.getActivityInfo(ComponentName(ctx, CallActivity::class.java), 0)

        assertEquals("MainActivity 不能越过锁屏", 0, (main.flags and SHOW_WHEN_LOCKED))
        assertEquals("MainActivity 不能亮屏", 0, (main.flags and TURN_SCREEN_ON))
        assertTrue("CallActivity 应声明越过锁屏", (call.flags and SHOW_WHEN_LOCKED) != 0)
        assertEquals("CallActivity 不应在清单里声明亮屏", 0, (call.flags and TURN_SCREEN_ON))
        assertFalse("CallActivity 不能导出", call.exported)
        assertEquals(ActivityInfo.LAUNCH_SINGLE_TASK, call.launchMode)
        assertEquals(ctx.packageName + ".call", call.taskAffinity)
    }

    private companion object {
        // ActivityInfo.FLAG_SHOW_WHEN_LOCKED / FLAG_TURN_SCREEN_ON 是 @hide，SDK stub 里没有，只能用字面量
        const val SHOW_WHEN_LOCKED = 0x800000
        const val TURN_SCREEN_ON = 0x1000000
    }
}
