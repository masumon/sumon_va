# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# @generated begin expo-build-properties - expo prebuild (DO NOT MODIFY)
# Neither native module ships consumer ProGuard rules of its own, and both are reached
# from JS by class name at runtime. Under R8 full mode their classes were renamed, so the
# TurboModule lookup threw, the JS caught it as "no native module", and the feature simply
# vanished from the UI with no error anywhere -- the camera button never rendered and the
# LLM runtime reported itself missing on a build that contained it.
-keep class com.imageanalysis.** { *; }
-keep class com.rnllama.** { *; }

# One layer deeper than the two rules above, and the same failure shape: Scripts.kt inside
# react-native-image-analysis itself resolves each ML Kit text-recognizer script with
# Class.forName("com.google.mlkit.vision.text.latin.TextRecognizerOptions") -- a bare string,
# invisible to R8's static analysis. R8 full mode renamed that class too, so every script
# lookup threw ClassNotFoundException, caught silently, leaving isSupported().textRecognition
# false on a real device even though the ML Kit .so and the rest of the wrapper were all
# present and correctly kept -- the OCR camera button vanished from both Home and Assistant
# with nothing in logcat to explain why.
-keep class com.google.mlkit.vision.text.** { *; }

# react-native-image-analysis reaches for ML Kit's subject-segmentation classes from its
# background-removal path. That dependency is optional and deliberately not installed:
# this app only ever calls analyzeImage() for text, never extractSubject(). R8 stops the
# whole build over the absent classes, so it is told they are absent on purpose. Adding
# the segmentation library instead would grow the APK for a feature nothing calls.
-dontwarn com.google.mlkit.vision.segmentation.subject.**

# Same failure shape a third time, this one in a shared Expo core path rather than a leaf
# feature module: AppLoaderProvider.createLoader() finds this class by name from a string
# baked into AndroidManifest.xml's own meta-data tag. expo-modules-core's own shipped rule
# (`-keep @expo.modules.core.interfaces.DoNotStrip class *`) doesn't match it, because the
# @DoNotStrip annotation in RNHeadlessAppLoader.kt sits on the constructor, not the class --
# so R8 full mode removed the class outright. Every OS-level background task this app
# registers (expo-background-task/expo-task-manager) needs this class to even start its JS
# callback; without it the task fails at native class-loading, silently, before any JS runs --
# confirmed live via logcat (ClassNotFoundException, BackgroundTaskScheduler: Task failed: null).
-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader { *; }

# @generated end expo-build-properties