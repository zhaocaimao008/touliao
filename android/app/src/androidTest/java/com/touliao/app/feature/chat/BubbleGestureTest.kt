package com.touliao.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.touliao.app.data.model.Message
import com.touliao.app.review.UiReviewActivity
import com.touliao.app.ui.theme.VxinTheme
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * BUBBLE-1 回归：媒体气泡长按能弹出消息菜单、单击按类型分发、多选态点击让给整行勾选。
 * 复用 NativeUIReviewTest 的 Hilt 测试宿主（UiReviewActivity + ReviewRunner），
 * 直接渲染单条 MessageBubble；resolveUrl 恒为 null，图片走加载失败占位，不发网络请求。
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class BubbleGestureTest {
    @get:Rule(order = 0) val hilt = HiltAndroidRule(this)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<UiReviewActivity>()

    private var current by mutableStateOf(message("text"))
    private var selection by mutableStateOf(false)
    private val taps = mutableListOf<String>()
    private var rowToggles = 0

    @Before fun setup() {
        compose.setContent {
            VxinTheme(darkTheme = false) {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().systemBarsPadding().padding(16.dp)) {
                        val msg = current
                        val selecting = selection
                        key(msg.id, selecting) {
                            // 与 ChatScreen 多选分支同构：多选态由整行 clickable 负责勾选
                            Row(Modifier.fillMaxWidth().then(if (selecting) Modifier.clickable { rowToggles++ } else Modifier)) {
                                Box(Modifier.weight(1f)) {
                                    MessageBubble(
                                        msg = msg,
                                        isMine = false,
                                        myId = "bubble-me",
                                        isRead = false,
                                        resolveUrl = { null },
                                        onPlayVoice = { taps += "voice" },
                                        onOpenFile = { taps += "file" },
                                        onReply = {},
                                        onRecall = {},
                                        onReact = {},
                                        onCollectSticker = {},
                                        onImageClick = { taps += "image" },
                                        onOpenMerged = { taps += "merged" },
                                        selectionMode = selecting,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @Test fun longPressOnMediaBubblesOpensMessageMenu() {
        for (type in listOf("image", "voice", "file", "video", "merged", "contact_card")) {
            show(message(type))
            content(type).performTouchInput { longClick() }
            compose.waitForIdle()
            // 「回复」是所有可长按气泡共有的菜单项；图片另有「保存图片」
            compose.onNodeWithText("回复").assertExists()
            if (type == "image") compose.onNodeWithText("保存图片").assertExists()
        }
        // 长按只开菜单，不能同时触发单击动作
        compose.runOnIdle { assertEquals(emptyList<String>(), taps) }
    }

    @Test fun tapDispatchesByMessageType() {
        for ((type, action) in listOf("image" to "image", "voice" to "voice", "file" to "file", "video" to "file", "merged" to "merged")) {
            show(message(type))
            content(type).performClick()
            compose.runOnIdle {
                assertEquals("type=$type", listOf(action), taps.toList())
                taps.clear()
            }
        }
        // 文本、名片：单击无动作（与原行为一致）
        for (type in listOf("text", "contact_card")) {
            show(message(type))
            content(type).performClick()
            compose.runOnIdle { assertEquals("type=$type", emptyList<String>(), taps.toList()) }
        }
    }

    @Test fun selectionModeTapTogglesRowInsteadOfOpeningContent() {
        val types = listOf("image", "voice", "file", "merged", "text")
        for (type in types) {
            show(message(type), selecting = true)
            content(type).performClick()
        }
        compose.runOnIdle {
            assertEquals(types.size, rowToggles)
            assertEquals(emptyList<String>(), taps.toList())
        }
    }

    @Test fun mediaBubbleExposesLabelledClickAndLongClickToScreenReaders() {
        show(message("image"))
        content("image")
            .assert(SemanticsMatcher("长按动作带朗读文字") {
                it.config.getOrNull(SemanticsActions.OnLongClick)?.label == BUBBLE_LONG_CLICK_LABEL
            })
            .assert(SemanticsMatcher("单击动作带朗读文字") {
                it.config.getOrNull(SemanticsActions.OnClick)?.label == BubbleTap.IMAGE.label
            })
    }

    private fun show(msg: Message, selecting: Boolean = false) {
        compose.runOnIdle { current = msg; selection = selecting }
        compose.waitForIdle()
    }

    private fun content(type: String) = compose.onNodeWithTag("msg-content-bubble-$type", useUnmergedTree = true)

    private fun message(type: String) = Message(
        id = "bubble-$type",
        conversation_id = "bubble-test",
        sender_id = "bubble-peer",
        type = type,
        content = if (type == "text") "长按这条消息" else "",
        created_at = 1789732400,
        senderName = "李明",
    )
}
