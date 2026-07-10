package com.vxin.app.feature.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.update.ApkDownloader
import com.vxin.app.core.update.ApkInstaller
import com.vxin.app.core.update.CheckResult
import com.vxin.app.core.update.UpdateChecker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/** 更新流程状态机 */
sealed class UpdateUiState {
    /** 空闲（未检查 / 已检查完） */
    data object Idle : UpdateUiState()

    /** 正在检查 */
    data object Checking : UpdateUiState()

    /** 已是最新版（弹窗显示"已是最新"） */
    data object UpToDate : UpdateUiState()

    /** 有新版可用，等待用户决策 */
    data class Available(
        val versionName: String,
        val notes: String,
    ) : UpdateUiState()

    /** 下载中 */
    data class Downloading(val progress: Float) : UpdateUiState()

    /** 下载完成，即将安装 */
    data class ReadyToInstall(val file: File) : UpdateUiState()

    /** 错误 */
    data class Error(val message: String) : UpdateUiState()
}

/** 启动时静默检查的结果，仅用于记录是否需要显示红点/徽标 */
sealed class SilentCheckResult {
    data object UpToDate : SilentCheckResult()
    data class HasUpdate(val versionName: String, val notes: String) : SilentCheckResult()
    data object Failed : SilentCheckResult()
}

@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val updateChecker: UpdateChecker,
    private val apkDownloader: ApkDownloader,
    private val apkInstaller: ApkInstaller,
) : ViewModel() {

    private val _uiState = MutableStateFlow<UpdateUiState>(UpdateUiState.Idle)
    val uiState: StateFlow<UpdateUiState> = _uiState.asStateFlow()

    /** 启动时静默检查的结果 */
    private val _silentResult = MutableStateFlow<SilentCheckResult?>(null)
    val silentResult: StateFlow<SilentCheckResult?> = _silentResult.asStateFlow()

    // 缓存当前有效的新版信息（下载进度和安装阶段仍需要）
    private var availableVersion: CheckResult.Available? = null

    /** 启动时静默检查（在 AppViewModel 或 Application 中调用） */
    fun silentCheck() {
        if (_uiState.value !is UpdateUiState.Idle) return
        viewModelScope.launch {
            when (val result = updateChecker.check()) {
                is CheckResult.Available -> {
                    availableVersion = result
                    _silentResult.value = SilentCheckResult.HasUpdate(result.versionName, result.notes)
                }
                is CheckResult.UpToDate -> {
                    _silentResult.value = SilentCheckResult.UpToDate
                }
                is CheckResult.Failed -> {
                    _silentResult.value = SilentCheckResult.Failed
                }
            }
        }
    }

    /** 用户主动点击「检查更新」 */
    fun checkForUpdate() {
        if (_uiState.value is UpdateUiState.Checking ||
            _uiState.value is UpdateUiState.Downloading
        ) return

        _uiState.value = UpdateUiState.Checking
        viewModelScope.launch {
            when (val result = updateChecker.check()) {
                is CheckResult.Available -> {
                    availableVersion = result
                    _uiState.value = UpdateUiState.Available(
                        versionName = result.versionName,
                        notes = result.notes,
                    )
                }
                is CheckResult.UpToDate -> {
                    _uiState.value = UpdateUiState.UpToDate
                }
                is CheckResult.Failed -> {
                    _uiState.value = UpdateUiState.Error(result.message)
                }
            }
        }
    }

    /** 开始下载（用户点了「更新」） */
    fun startDownload() {
        val version = availableVersion ?: run {
            _uiState.value = UpdateUiState.Error("版本信息丢失，请重新检查")
            return
        }

        _uiState.value = UpdateUiState.Downloading(progress = 0f)
        viewModelScope.launch {
            runCatching {
                apkDownloader.download(version.url) { bytes, total, percent ->
                    _uiState.update {
                        if (it is UpdateUiState.Downloading) it.copy(progress = percent)
                        else it // 状态已变，忽略旧进度
                    }
                }
            }.onSuccess { file ->
                _uiState.value = UpdateUiState.ReadyToInstall(file)
                // 立即触发安装
                withContext(Dispatchers.Main) {
                    apkInstaller.install(file)
                }
            }.onFailure { e ->
                _uiState.value = UpdateUiState.Error("下载失败：${e.localizedMessage ?: "未知错误"}")
            }
        }
    }

    /** 关闭弹窗 / 回到空闲 */
    fun dismiss() {
        // 下载中不允许关闭，防止应用状态混乱
        if (_uiState.value is UpdateUiState.Downloading) return
        _uiState.value = UpdateUiState.Idle
        // 清除静默结果标记
        _silentResult.value = null
    }

    /** 是否有未处理的新版（给 UI 显示红点用） */
    fun hasPendingUpdate(): Boolean {
        return _silentResult.value is SilentCheckResult.HasUpdate
    }
}
