pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // 个推 SDK 仓库（国产 ROM 离线推送覆盖）
        maven { url = uri("https://mvn.getui.com/nexus/content/repositories/releases/") }
    }
}

rootProject.name = "Vxin"
include(":app")
