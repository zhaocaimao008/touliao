package com.touliao.app.core.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.touliao.app.core.network.AuthInterceptor
import com.touliao.app.core.network.HostSelectionInterceptor
import com.touliao.app.core.storage.ServerConfig
import com.touliao.app.data.api.AuthApi
import com.touliao.app.data.api.ContactApi
import com.touliao.app.data.api.GroupApi
import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.api.NotificationApi
import com.touliao.app.data.api.SearchApi
import com.touliao.app.data.api.StickerApi
import com.touliao.app.data.api.UserApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AppScope

/**
 * 与 provideOkHttpClient 超时一致，但不挂 hostSelectionInterceptor / authInterceptor：
 * 供直接下载完整 URL 的场景用（PDF 预览、保存视频到相册等，见 FileDownloader.kt /
 * MediaPreviewOverlays.kt）。这些 URL 已带鉴权 token 或指向云存储域名——若混进主
 * client，hostSelectionInterceptor 会无条件把请求 host 强改成当前配置的 API 服务器，
 * 云存储直链会被错误地重写成打到 API 服务器，下载必然失败。
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DownloadHttpClient

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    @AppScope
    fun provideAppScope(): CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        // partial-update 关键：null 字段不编码（省略）。否则后端 normalizeSettings 以
        // `body[k] !== undefined` 判定，会把 JSON null 当 false，改一个开关就误关其它所有开关。
        explicitNulls = false
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        hostSelectionInterceptor: HostSelectionInterceptor,
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        return OkHttpClient.Builder()
            // 超时:默认仅 10s,弱网/大文件(分片上传单片、视频、二维码下载)必触发 SocketTimeout。
            // 连接 20s;读写 60s 容纳慢上传/下载;callTimeout=0 不设总时长上限,靠读写超时兜底。
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(0, TimeUnit.SECONDS)
            .addInterceptor(hostSelectionInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()
    }

    // 三处此前各自 new 一个裸 OkHttpClient()，默认 10s 超时，弱网/大文件(PDF/视频)必触发
    // SocketTimeout——同 provideOkHttpClient 一样拉长到 20s/60s/60s，但不挂那两个 API
    // 专用拦截器（见 DownloadHttpClient 上的注释）。
    @Provides
    @Singleton
    @DownloadHttpClient
    fun provideDownloadOkHttpClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    @Provides
    @Singleton
    fun provideRetrofit(
        client: OkHttpClient,
        json: Json,
        serverConfig: ServerConfig,
    ): Retrofit = Retrofit.Builder()
        .baseUrl(serverConfig.baseUrlWithSlash())
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun provideMessageApi(retrofit: Retrofit): MessageApi = retrofit.create(MessageApi::class.java)

    @Provides
    @Singleton
    fun provideNotificationApi(retrofit: Retrofit): NotificationApi = retrofit.create(NotificationApi::class.java)

    @Provides
    @Singleton
    fun provideContactApi(retrofit: Retrofit): ContactApi = retrofit.create(ContactApi::class.java)

    @Provides
    @Singleton
    fun provideUserApi(retrofit: Retrofit): UserApi = retrofit.create(UserApi::class.java)

    @Provides
    @Singleton
    fun provideConfigApi(retrofit: Retrofit): com.touliao.app.data.api.ConfigApi =
        retrofit.create(com.touliao.app.data.api.ConfigApi::class.java)

    @Provides
    @Singleton
    fun provideGroupApi(retrofit: Retrofit): GroupApi = retrofit.create(GroupApi::class.java)

    @Provides
    @Singleton
    fun provideSearchApi(retrofit: Retrofit): SearchApi = retrofit.create(SearchApi::class.java)

    @Provides
    @Singleton
    fun provideStickerApi(retrofit: Retrofit): StickerApi = retrofit.create(StickerApi::class.java)

    @Provides
    @Singleton
    fun provideWalletApi(retrofit: Retrofit): com.touliao.app.data.api.WalletApi =
        retrofit.create(com.touliao.app.data.api.WalletApi::class.java)

    @Provides
    @Singleton
    fun provideFriendLabelApi(retrofit: Retrofit): com.touliao.app.data.api.FriendLabelApi =
        retrofit.create(com.touliao.app.data.api.FriendLabelApi::class.java)

    @Provides
    @Singleton
    fun provideRedPacketApi(retrofit: Retrofit): com.touliao.app.data.api.RedPacketApi =
        retrofit.create(com.touliao.app.data.api.RedPacketApi::class.java)

    @Provides
    @Singleton
    fun provideTurnApi(retrofit: Retrofit): com.touliao.app.data.api.TurnApi =
        retrofit.create(com.touliao.app.data.api.TurnApi::class.java)

    @Provides
    @Singleton
    fun provideFavoritesApi(retrofit: Retrofit): com.touliao.app.data.api.FavoritesApi =
        retrofit.create(com.touliao.app.data.api.FavoritesApi::class.java)

    @Provides
    @Singleton
    fun provideMomentApi(retrofit: Retrofit): com.touliao.app.data.api.MomentApi =
        retrofit.create(com.touliao.app.data.api.MomentApi::class.java)
}
