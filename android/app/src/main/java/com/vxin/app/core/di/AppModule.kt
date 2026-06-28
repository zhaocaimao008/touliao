package com.vxin.app.core.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.vxin.app.core.network.AuthInterceptor
import com.vxin.app.core.network.HostSelectionInterceptor
import com.vxin.app.core.storage.ServerConfig
import com.vxin.app.data.api.AuthApi
import com.vxin.app.data.api.ContactApi
import com.vxin.app.data.api.GroupApi
import com.vxin.app.data.api.MessageApi
import com.vxin.app.data.api.NotificationApi
import com.vxin.app.data.api.SearchApi
import com.vxin.app.data.api.StickerApi
import com.vxin.app.data.api.UserApi
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
    fun provideConfigApi(retrofit: Retrofit): com.vxin.app.data.api.ConfigApi =
        retrofit.create(com.vxin.app.data.api.ConfigApi::class.java)

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
    fun provideRedPacketApi(retrofit: Retrofit): com.vxin.app.data.api.RedPacketApi =
        retrofit.create(com.vxin.app.data.api.RedPacketApi::class.java)

    @Provides
    @Singleton
    fun provideTurnApi(retrofit: Retrofit): com.vxin.app.data.api.TurnApi =
        retrofit.create(com.vxin.app.data.api.TurnApi::class.java)

    @Provides
    @Singleton
    fun provideFavoritesApi(retrofit: Retrofit): com.vxin.app.data.api.FavoritesApi =
        retrofit.create(com.vxin.app.data.api.FavoritesApi::class.java)

    @Provides
    @Singleton
    fun provideMomentApi(retrofit: Retrofit): com.vxin.app.data.api.MomentApi =
        retrofit.create(com.vxin.app.data.api.MomentApi::class.java)
}
