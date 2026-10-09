# JNA binds native Vosk symbols and structures by their original names.
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
# WebView invokes these methods reflectively. Without this, release shrinking
# removes/renames the bridge API even though debug Java compilation succeeds.
-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn java.awt.**
-dontwarn javax.swing.**
