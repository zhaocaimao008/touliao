plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.google.services)
}

android {
    namespace = "com.touliao.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.touliao.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 68
        versionName = "8.1.6"

        // 默认服务器地址（运行时可在 App 内切换并持久化覆盖）
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://touliao.cc\"")

        // 个推密钥从环境变量/CI Secrets 注入，不硬编码到代码里。
        // 占位符名与个推 SDK 内置 Manifest 要求一致（GETUI_APPID/GETUI_APPKEY/GETUI_APPSECRET）。
        // 拿到 key 后设环境变量：GETUI_APP_ID / GETUI_APP_KEY / GETUI_APP_SECRET
        manifestPlaceholders["GETUI_APPID"]     = System.getenv("GETUI_APP_ID")     ?: ""
        manifestPlaceholders["GETUI_APPKEY"]    = System.getenv("GETUI_APP_KEY")    ?: ""
        manifestPlaceholders["GETUI_APPSECRET"] = System.getenv("GETUI_APP_SECRET") ?: ""
    }

    // release 签名：密钥从环境变量读取（CI 用 GitHub Secrets 注入）。
    // 未配置时（如本地普通构建）不签名，不影响 debug 构建与编译验证。
    val ksPath = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        create("release") {
            if (ksPath != null && file(ksPath).exists()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                // ⚠ 必须显式开启 v1(JAR)签名：minSdk>=24 时 AGP 默认关闭 v1、只打 v2/v3，
                //   但个推 libzxprotect.so 启动时校验 v1 签名(META-INF/CERT.*)做防篡改，
                //   缺 v1 → native 层 SIGABRT(Kotlin runCatching 拦不住) → 所有安卓机启动即闪退。
                //   同时保留 v2/v3(更快校验、防 v1 剥离攻击)。
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (ksPath != null && file(ksPath).exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = libs.versions.composeCompiler.get()
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material)   // 仅用 pullRefresh（material3 1.2 无 PullToRefresh）
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.security.crypto)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // Network
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // Realtime
    implementation(libs.socketio.client)

    // Image loading
    implementation(libs.coil.compose)
    implementation(libs.coil.svg)   // 登录验证码是后端生成的 SVG data URL，Coil 默认不解码 SVG，需要这个官方扩展
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    // 扫码（Google Code Scanner，按需下载模块，免相机权限）
    implementation(libs.play.services.code.scanner)

    // WebRTC 音视频通话
    implementation(libs.webrtc)

    // Push (Firebase Cloud Messaging)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // 个推 SDK（国产 ROM 覆盖，无 GMS 设备锁屏通知兜底）
    // AppID/AppKey/AppSecret 在 manifestPlaceholders 注入，不硬编码
    // DEVICE-P1-001: exclude com.zxid.sdk:sdk-prod-channel-getui（getui 传递依赖）。
    //   该 SDK 的 libzxprotect.so 启动时 native 校验宿主包名/签名（packageName/signatureNonce/
    //   persist.sys.package.SHA1/HmacSHA1），包名 com.vxin.app→com.touliao.app 后校验不匹配 →
    //   native abort（SIGABRT），Java runCatching 拦不住 → 所有机型启动即闪退。
    //   getui 通过反射调用 ZXManager（Class.forName + try/catch），类缺失会被捕获，
    //   不影响 getui 核心 CID 注册/推送。
    implementation(libs.getui.sdk) {
        exclude(group = "com.zxid.sdk", module = "sdk-prod-channel-getui")
    }
    // gtc 必须显式声明:gtsdk 3.2.17.0+ 官方要求 gtc>=3.2.4.0(旧 gtc 3.2.1.0 有注册兼容问题)
    implementation(libs.getui.gtc)

    // Unit tests (pure JVM; offline msgCache 语义基线对齐 Web vitest)
    testImplementation(libs.junit)
}
