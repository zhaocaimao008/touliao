package com.touliao.app.review

import com.touliao.app.core.di.AppScope
import com.touliao.app.core.di.DownloadHttpClient
import com.touliao.app.core.di.AppModule
import dagger.hilt.testing.TestInstallIn
import okhttp3.Response
import okhttp3.Protocol
import okhttp3.ResponseBody.Companion.toResponseBody
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject

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

@Module
@TestInstallIn(components = [SingletonComponent::class], replaces = [AppModule::class])
object ReviewModule {
    val requests = java.util.Collections.synchronizedList(mutableListOf<String>())
    private val fixtures by lazy {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        JSONObject(assets.open("fixtures.json").bufferedReader().use { it.readText() })
    }
    private fun isolatedClient() = OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val path = request.url.encodedPath
        requests.add(request.method + " " + path)
        val json = fixtures.opt(path)?.toString() ?: when {
            path.endsWith("/sync") -> "{\"messages\":[],\"cursor\":0,\"hasMore\":false}"
            path.endsWith("/read-states") -> "{\"states\":{}}"
            path.endsWith("/settings") -> "{}"
            else -> "[]"
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("isolated UI fixture")
            .body(json.toResponseBody("application/json".toMediaType())).build()
    }.build()


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
        return isolatedClient()
    }

    // 三处此前各自 new 一个裸 OkHttpClient()，默认 10s 超时，弱网/大文件(PDF/视频)必触发
    // SocketTimeout——同 provideOkHttpClient 一样拉长到 20s/60s/60s，但不挂那两个 API
    // 专用拦截器（见 DownloadHttpClient 上的注释）。
    @Provides
    @Singleton
    @DownloadHttpClient
    fun provideDownloadOkHttpClient(): OkHttpClient {
        return isolatedClient()
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
