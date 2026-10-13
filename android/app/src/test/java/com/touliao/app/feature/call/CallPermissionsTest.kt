package com.touliao.app.feature.call

import android.Manifest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CallPermissionsTest {
    private val mic = Manifest.permission.RECORD_AUDIO
    private val camera = Manifest.permission.CAMERA
    private val bluetooth = Manifest.permission.BLUETOOTH_CONNECT

    @Test
    fun requestIncludesBluetoothOnlyOnAndroid12AndAbove() {
        assertArrayEquals(arrayOf(mic), CallPermissions.toRequest(isVideo = false, sdkInt = 30))
        assertArrayEquals(arrayOf(mic, bluetooth), CallPermissions.toRequest(isVideo = false, sdkInt = 31))
        assertArrayEquals(arrayOf(mic, camera, bluetooth), CallPermissions.toRequest(isVideo = true, sdkInt = 34))
    }

    @Test
    fun onlyBluetoothDeniedIsNotReportedAsMissingMicOrCamera() {
        val denied = CallPermissions.deniedRequired(mapOf(mic to true, camera to true, bluetooth to false))
        assertEquals(emptyList<String>(), denied)
        assertNull(CallPermissions.deniedMessage(denied))
    }

    @Test
    fun deniedMessageNamesExactlyTheMissingRequiredPermissions() {
        val micOnly = CallPermissions.deniedRequired(mapOf(mic to false, bluetooth to false))
        assertEquals(listOf(mic), micOnly)
        assertEquals("缺少麦克风权限，通话可能无法正常进行", CallPermissions.deniedMessage(micOnly))

        val cameraOnly = CallPermissions.deniedRequired(mapOf(mic to true, camera to false, bluetooth to true))
        assertEquals("摄像头", CallPermissions.displayName(cameraOnly))

        val both = CallPermissions.deniedRequired(mapOf(camera to false, mic to false))
        assertEquals(listOf(mic, camera), both)
        assertEquals("缺少麦克风和摄像头权限，通话可能无法正常进行", CallPermissions.deniedMessage(both))
    }

    @Test
    fun interruptedRequestWithEmptyResultIsNotReported() {
        assertNull(CallPermissions.deniedMessage(CallPermissions.deniedRequired(emptyMap())))
    }
}
