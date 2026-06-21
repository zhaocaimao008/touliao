# Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.vxin.app.data.model.** {
    *** Companion;
}
-keepclasseswithmembers class com.vxin.app.data.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit
-keepattributes Signature, Exceptions
-dontwarn okhttp3.**
-dontwarn retrofit2.**
