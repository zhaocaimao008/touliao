# 投聊 release R8 规则（AGP 8 默认 R8 full mode）。
# 大部分依赖自带 consumer rules（OkHttp、Coroutines、Hilt/Dagger、Firebase、Coil、Media3、ML Kit、
# kotlinx.serialization 1.6+、个推 gtsdk/gtc），这里只补充缺失或需要更保守处理的部分。

# ---------- 通用 ----------
# 崩溃堆栈可读：保留行号，源文件名统一替换（配合 CI 上传的 mapping.txt 反混淆）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes Signature, InnerClasses, EnclosingMethod, Exceptions, *Annotation*
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault

# ---------- kotlinx.serialization：应用内所有 @Serializable 模型 ----------
# 库自带规则已覆盖 Companion/serializer()，这里对本应用模型更保守：
# 网络 DTO、本地缓存（MsgCacheStore/OutboxStore）、合并转发 JSON 都依赖这些类，整体保留。
-dontnote kotlinx.serialization.**
-dontwarn kotlinx.serialization.internal.ClassValueReferences
-keep @kotlinx.serialization.Serializable class com.touliao.app.** { *; }
-keep class com.touliao.app.**$$serializer { *; }
-keepclassmembers class com.touliao.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.touliao.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep class com.touliao.app.data.model.** { *; }

# ---------- Hilt ViewModel ----------
# Hilt 2.52 用 @LazyClassKey + R8 -identifiernamestring 改写 ViewModel 类名键；
# 再保留类名作双保险（且崩溃堆栈更易读），代价可忽略。
-keepnames @dagger.hilt.android.lifecycle.HiltViewModel class * extends androidx.lifecycle.ViewModel

# ---------- Retrofit 2.9（自带规则不含 full mode 所需部分，取自 Retrofit 2.10+ 官方规则） ----------
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface <1>
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface * extends <1>
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-if interface * { @retrofit2.http.* public *** *(...); }
-keep,allowoptimization,allowshrinking,allowobfuscation class <3>
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
-dontwarn javax.annotation.**
-dontwarn kotlin.Unit
-dontwarn retrofit2.KotlinExtensions
-dontwarn retrofit2.KotlinExtensions$*
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**

# ---------- socket.io-client / engine.io-client（无自带规则，体积小，整体保留） ----------
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# ---------- WebRTC（大量 JNI 回调 Java 方法/字段，按名查找，必须整体保留） ----------
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# ---------- 个推（gtsdk/gtc 自带规则基础上再兜底；zxid 已在依赖中排除，反射调用有 try/catch） ----------
-keep class com.igexin.** { *; }
-keep class com.getui.** { *; }
-keep class igexin.** { *; }
-dontwarn com.igexin.**
-dontwarn com.getui.**
-dontwarn com.zxid.**

# ---------- 应用四大组件 / 推送回调（manifest 已保留类名，这里保留个推回调方法签名） ----------
-keep class com.touliao.app.core.push.** extends android.app.Service { *; }
-keep class * extends com.igexin.sdk.GTIntentService { *; }

# ---------- Parcelable / 枚举 ----------
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
-keepclassmembers enum com.touliao.app.** {
    <fields>;
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

