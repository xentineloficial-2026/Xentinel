allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

subprojects {
    // HACK: Forzar a todos los plugins (como vibration) a usar SDK 36
    project.afterEvaluate {
        val androidExt = project.extensions.findByName("android")
        if (androidExt != null) {
            val extension = androidExt as com.android.build.gradle.BaseExtension
            extension.compileSdkVersion(36)
            extension.defaultConfig.targetSdk = 36
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
