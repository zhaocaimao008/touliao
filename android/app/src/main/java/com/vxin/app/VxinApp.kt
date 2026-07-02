package com.vxin.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.intercept.Interceptor
import coil.request.ImageResult
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class VxinApp : Application(), ImageLoaderFactory {

    /**
     * 自定义 Coil ImageLoader：
     * 1) 稳定磁盘缓存键——/uploads 受保护资源的地址带 ?token=<JWT>，而 Coil 默认以
     *    完整 URL 作缓存键。JWT 轮换(刷新/重登)后所有图片键失效→头像/图片全部重新
     *    下载。这里剥掉 query 只用路径作 diskCacheKey，令已下载的原始字节跨 token 轮换
     *    存活，避免重复下载（真正的观感/流量杀手）；真正请求仍走带 token 的原地址
     *    （data 不变），鉴权不受影响。
     *    ⚠ 只稳定 diskCacheKey、不动 memoryCacheKey：内存键仍含尺寸信息，避免同一图
     *    在不同尺寸(气泡缩略图 vs 全屏大图)命中同一 bitmap 而糊掉；内存未命中时从磁盘
     *    按当前尺寸重新解码，无网络开销、且清晰。
     * 2) crossfade 淡入，加载观感更顺滑。
     */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .crossfade(true)
            .components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                        val req = chain.request
                        val data = req.data
                        if (data is String && data.contains("token=")) {
                            val stableKey = data.substringBefore("?")
                            return chain.proceed(
                                req.newBuilder()
                                    .diskCacheKey(stableKey)
                                    .build()
                            )
                        }
                        return chain.proceed(req)
                    }
                })
            }
            .build()
}
