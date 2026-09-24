package com.touliao.app.core.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageUploadPolicyTest {
    @Test fun heicAndHeifAreAlwaysTranscoded() {
        assertTrue(ImageUploadPolicy.needsTranscode("image/heic", 4032, 3024))
        assertTrue(ImageUploadPolicy.needsTranscode("image/heif", 0, 0))
        assertTrue(ImageUploadPolicy.needsTranscode("IMAGE/HEIC; charset=binary", 100, 100))
    }

    @Test fun commonFormatsWithinServerLimitAreUploadedAsIs() {
        assertFalse(ImageUploadPolicy.needsTranscode("image/jpeg", 4000, 3000))
        assertFalse(ImageUploadPolicy.needsTranscode("image/png", 1080, 2400))
        assertFalse(ImageUploadPolicy.needsTranscode("image/webp", 0, 0))
        assertFalse(ImageUploadPolicy.needsTranscode("image/gif", 9000, 9000))
        assertFalse(ImageUploadPolicy.needsTranscode("video/mp4", 8000, 8000))
        assertFalse(ImageUploadPolicy.needsTranscode("application/pdf", 0, 0))
    }

    @Test fun photosAboveServerPixelLimitAreTranscoded() {
        assertTrue(ImageUploadPolicy.needsTranscode("image/jpeg", 8160, 6120)) // 5000 万像素
        assertFalse(ImageUploadPolicy.needsTranscode("image/jpeg", 8000, 5000)) // 恰好 4000 万
    }

    @Test fun targetSizeKeepsAspectAndCapsLongEdge() {
        assertEquals(4096 to 3072, ImageUploadPolicy.targetSize(8160, 6120))
        assertEquals(3072 to 4096, ImageUploadPolicy.targetSize(6120, 8160))
        assertEquals(4032 to 3024, ImageUploadPolicy.targetSize(4032, 3024))
    }

    @Test fun sampleSizeNeverUndershootsTarget() {
        assertEquals(1, ImageUploadPolicy.sampleSize(4032, 3024))
        assertEquals(2, ImageUploadPolicy.sampleSize(12000, 9000))
        assertEquals(1, ImageUploadPolicy.sampleSize(8160, 6120))
    }

    @Test fun jpegNameReplacesExtension() {
        assertEquals("IMG_1234.jpg", ImageUploadPolicy.jpegName("IMG_1234.HEIC"))
        assertEquals("photo.jpg", ImageUploadPolicy.jpegName("photo"))
    }
}
