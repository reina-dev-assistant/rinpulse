package com.joyodigitama.replayencoder

import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** `EncoderConfigInput` in `ReplayEncoder.types.ts`. Numbers stay doubles so the pure config check sees what JS sent. */
class EncoderConfigRecord : Record {
  @Field var path: String = ""
  @Field var width: Double = 0.0
  @Field var height: Double = 0.0
  @Field var fps: Double = 0.0
  @Field var bitrate: Double? = null
}

/** The session the module owns: the video plus the single thread all its work runs on. */
private class ActiveSession(val id: String, val executor: ExecutorService) {
  /** Set by the first task on [executor]; every later task sees it. */
  @Volatile var video: VideoSession? = null

  @Volatile var cancelled = false

  /** Set once `finish` was accepted: no more frames. */
  @Volatile var closing = false
}

/**
 * Expo module implementing `ReplayEncoder.ts`. One session at a time. All encoding runs on the session's own single-thread
 * executor, never the JS or main thread. A promise settles from that thread when the work it asked for is done.
 */
class ReplayEncoderModule : Module() {
  private val lock = Any()
  private var active: ActiveSession? = null

  override fun definition() = ModuleDefinition {
    Name("ReplayEncoder")

    OnDestroy {
      synchronized(lock) { active.also { active = null } }?.let { stop(it, deleteFile = true, promise = null) }
    }

    AsyncFunction("getSupport") { CodecSupport.support() }

    AsyncFunction("begin") { input: EncoderConfigRecord, promise: Promise ->
      try {
        begin(input, promise)
      } catch (e: Throwable) {
        promise.fail(e)
      }
    }

    AsyncFunction("appendFrame") { id: String, frameUri: String, index: Double, promise: Promise ->
      try {
        appendFrame(id, frameUri, index, promise)
      } catch (e: Throwable) {
        promise.fail(e)
      }
    }

    AsyncFunction("finish") { id: String, promise: Promise ->
      try {
        finish(id, promise)
      } catch (e: Throwable) {
        promise.fail(e)
      }
    }

    AsyncFunction("cancel") { id: String, promise: Promise ->
      val session = synchronized(lock) { active?.takeIf { it.id == id }?.also { active = null } }
      if (session == null) promise.resolve() else stop(session, deleteFile = true, promise = promise)
    }
  }

  private fun begin(input: EncoderConfigRecord, promise: Promise) {
    val config = EncoderConfig.resolve(input.width, input.height, input.fps, input.bitrate)
    val file = File(FilePaths.fromUri(input.path, ErrorCodes.CONFIG))
    val session = ActiveSession(UUID.randomUUID().toString(), Executors.newSingleThreadExecutor { Thread(it, "replay-encoder") })
    synchronized(lock) {
      if (active != null) {
        session.executor.shutdown()
        throw EncoderException(ErrorCodes.STATE, "An encoder session is already active")
      }
      active = session
    }
    session.executor.execute {
      try {
        val video = VideoSession.open(config, file)
        session.video = video
        if (session.cancelled) throw EncoderException(ErrorCodes.STATE, "The encoder session was cancelled")
        promise.resolve(
          mapOf(
            "id" to session.id,
            "width" to config.width,
            "height" to config.height,
            "fps" to config.fps,
            "bitrate" to config.bitrate,
            "path" to input.path,
          ),
        )
      } catch (e: Throwable) {
        // A failed or cancelled open leaves nothing behind; a cancelled one is cleaned up by the stop task queued behind this.
        drop(session)
        session.video?.release(deleteFile = true)
        session.executor.shutdown()
        promise.fail(e)
      }
    }
  }

  private fun appendFrame(id: String, frameUri: String, index: Double, promise: Promise) {
    val session = find(id)
    if (session.closing) throw EncoderException(ErrorCodes.STATE, "The encoder session is finishing")
    if (index != Math.rint(index) || index < 0 || index > Int.MAX_VALUE) {
      throw EncoderException(ErrorCodes.FRAME, "Frame index must be a non-negative integer, got $index")
    }
    val frame = File(FilePaths.fromUri(frameUri, ErrorCodes.FRAME))
    submit(session, promise) {
      val video = session.video ?: throw EncoderException(ErrorCodes.STATE, "The encoder session is not open")
      try {
        video.append(frame, index.toLong())
      } catch (e: EncoderException) {
        // A bad frame or index leaves the session consistent; anything else (codec, muxer, cancel) is fatal.
        if (e.code != ErrorCodes.FRAME) teardown(session)
        throw e
      } catch (e: Throwable) {
        teardown(session)
        throw e
      }
      promise.resolve()
    }
  }

  private fun finish(id: String, promise: Promise) {
    val session = find(id)
    if (session.closing) throw EncoderException(ErrorCodes.STATE, "The encoder session is already finishing")
    session.closing = true
    submit(session, promise) {
      val video = session.video ?: throw EncoderException(ErrorCodes.STATE, "The encoder session is not open")
      val result = try {
        video.finish()
      } catch (e: Throwable) {
        teardown(session)
        throw e
      }
      drop(session)
      session.executor.shutdown()
      promise.resolve(
        mapOf(
          "uri" to Uri.fromFile(File(result.path)).toString(),
          "bytes" to result.bytes.toDouble(),
          "frames" to result.frames.toDouble(),
          "durationMs" to result.durationMs.toDouble(),
        ),
      )
    }
  }

  private fun find(id: String): ActiveSession =
    synchronized(lock) { active?.takeIf { it.id == id } } ?: throw EncoderException(ErrorCodes.STATE, "Unknown or finished encoder session: $id")

  /** Runs [work] on the session thread; a cancelled session or a rejected task fails the promise instead. */
  private fun submit(session: ActiveSession, promise: Promise, work: () -> Unit) {
    try {
      session.executor.execute {
        try {
          if (session.cancelled) throw EncoderException(ErrorCodes.STATE, "The encoder session was cancelled")
          work()
        } catch (e: Throwable) {
          promise.fail(if (session.cancelled && e !is EncoderException) EncoderException(ErrorCodes.STATE, "The encoder session was cancelled", e) else e)
        }
      }
    } catch (e: RejectedExecutionException) {
      throw EncoderException(ErrorCodes.STATE, "The encoder session was cancelled", e)
    }
  }

  private fun drop(session: ActiveSession) {
    synchronized(lock) { if (active === session) active = null }
  }

  /** Called on the session thread after a fatal failure: frees the codec, deletes the file and lets a new session begin. */
  private fun teardown(session: ActiveSession) {
    session.cancelled = true
    drop(session)
    session.video?.release(deleteFile = true)
    session.executor.shutdown()
  }

  /**
   * Cancels [session] from any thread: flags it so queued work fails and the polling loops give up, then queues the cleanup
   * behind whatever is in flight on the session thread, so the codec is never released under a running frame.
   */
  private fun stop(session: ActiveSession, deleteFile: Boolean, promise: Promise?) {
    session.cancelled = true
    session.video?.abort()
    try {
      session.executor.execute {
        session.video?.release(deleteFile)
        promise?.resolve()
      }
    } catch (e: RejectedExecutionException) {
      // The session thread already shut down after tearing itself down, so there is nothing left to release.
      promise?.resolve()
    }
    session.executor.shutdown()
  }

  private fun Promise.fail(error: Throwable) {
    if (error is EncoderException) reject(error.code, error.message, error) else reject(ErrorCodes.IO, error.message ?: error.javaClass.simpleName, error)
  }
}
