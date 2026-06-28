package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class UploadInitBody(
    val filename: String,
    val size: Long,
    val hash: String,
    val mime: String,
)

@Serializable
data class UploadInitResponse(
    val uploadId: String,
    val received: Long = 0,
    val chunkSize: Long = 4 * 1024 * 1024,
)

@Serializable
data class ChunkReceivedResponse(
    val received: Long,
)

@Serializable
data class UploadFinishBody(
    val reply_to_id: String? = null,
)

/** 409 偏移不一致时服务端返回 */
@Serializable
data class ChunkConflictResponse(
    val error: String? = null,
    val received: Long? = null,
)