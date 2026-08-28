package com.touliao.app.core.push

import com.igexin.sdk.PushService

/**
 * 个推长连接服务（必须继承 com.igexin.sdk.PushService 并在 manifest 声明，
 * 否则 checkManifest 报「未找到继承 PushService 的子类」且 CID 永远为空）。
 *
 * 官方要求：App 必须声明一个继承 PushService 的 Service 子类，由个推框架
 * 实例化并跑在独立进程 :pushservice，负责与个推服务器保持长连接。
 * SDK 自带的 com.igexin.sdk.PushService 只是基类，不能直接替代子类声明。
 */
class TouliaoPushService : PushService()
