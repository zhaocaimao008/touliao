package com.vxin.app.feature.wallet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.WalletTransaction
import com.vxin.app.data.repository.WalletRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WalletUiState(
    val loading: Boolean = true,
    val balance: Int = 0,
    val transactions: List<WalletTransaction> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class WalletViewModel @Inject constructor(
    private val walletRepository: WalletRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val bal = walletRepository.balance()
                val txs = runCatching { walletRepository.transactions() }.getOrDefault(emptyList())
                bal to txs
            }.onSuccess { (bal, txs) ->
                _uiState.update { it.copy(loading = false, balance = bal, transactions = txs) }
            }.onFailure { e ->
                _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载钱包失败")) }
            }
        }
    }
}
