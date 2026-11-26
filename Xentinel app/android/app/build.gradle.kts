import java.util.Properties

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services") apply false
}

// Sin google-services.json (Firebase) la app compila igual y las alertas push quedan desactivadas.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// Production signing is supplied locally and never falls back to the debug key.
val signingProperties = Properties()
val signingFile = rootProject.file("key.properties")
if (signingFile.exists()) signingFile.inputStream().use { signingProperties.load(it) }
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
if (releaseRequested) {
    require(signingFile.exists()) { "Configure android/key.properties antes de generar una versión de distribución." }
    listOf("storeFile", "storePassword", "keyAlias", "keyPassword").forEach {
        require(!signingProperties.getProperty(it).isNullOrBlank()) { "Falta $it en android/key.properties" }
    }
}

android {
    namespace = "co.edu.sena.xentinel"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications usa APIs de java.time en Android antiguos.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "co.edu.sena.xentinel"
        minSdk = flutter.minSdkVersion
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        // Siempre la misma clave del proyecto (CN=Xentinel): scripts/build-release.sh
        // rechaza el APK si el certificado no coincide con la huella fijada allí.
        if (signingFile.exists()) create("production") {
            storeFile = rootProject.file(signingProperties.getProperty("storeFile"))
            storePassword = signingProperties.getProperty("storePassword")
            keyAlias = signingProperties.getProperty("keyAlias")
            keyPassword = signingProperties.getProperty("keyPassword")
            // Esquemas estándar: v1 (JAR) para instaladores antiguos, v2 y v3 (rotación).
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("production")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
