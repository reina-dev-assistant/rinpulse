package com.joyodigitama.huaweiwear

import android.content.Context
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * One import at a time: opens the ZIP, runs a [HuaweiExportImporter] against `joyofit.db` and reports progress through
 * [emit] (`onHuaweiImportProgress`). The password lives in a `CharArray` that is wiped when the import ends; it is
 * never stored or logged.
 */
internal class HuaweiImportController(
  private val context: Context,
  private val syncStore: SyncStore,
  private val emit: (Map<String, Any?>) -> Unit,
) {
  private val running = AtomicBoolean(false)

  @Volatile
  private var cancelRequested = false

  fun cancel() {
    cancelRequested = true
  }

  fun displayName(uri: String): String? = HuaweiExportFiles.displayName(context, uri)

  fun run(uri: String, password: String): Map<String, Any?> {
    if (!running.compareAndSet(false, true)) throw WearException(ErrorCodes.BUSY, "An import is already running")
    cancelRequested = false
    val chars = password.toCharArray()
    try {
      HuaweiExportFiles.open(context, uri, chars).use { opened ->
        val importer = HuaweiExportImporter(
          store = SqliteHuaweiImportStore { syncStore.db() },
          onProgress = { emit(it.toJs()) },
          isCancelled = { cancelRequested },
        )
        return importer.run(opened.source).toJs()
      }
    } catch (e: HuaweiImportException) {
      val code = when (e.kind) {
        HuaweiImportException.Kind.BAD_PASSWORD -> ErrorCodes.IMPORT_PASSWORD
        HuaweiImportException.Kind.NOT_A_ZIP, HuaweiImportException.Kind.NOT_AN_EXPORT -> ErrorCodes.IMPORT_FORMAT
        HuaweiImportException.Kind.STORAGE -> ErrorCodes.STORAGE
      }
      throw WearException(code, e.message ?: "Import failed", e)
    } finally {
      chars.fill('\u0000')
      running.set(false)
    }
  }
}

/**
 * The Huawei Health history import of the `HuaweiWear` module (`importHuaweiExport`, `cancelHuaweiImport` in
 * `HuaweiWearModule.ts`); progress goes out as `onHuaweiImportProgress`. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.huaweiImportApi(runtime: () -> WearRuntime, emit: (String, Map<String, Any?>) -> Unit) {
  val controller by lazy {
    val r = runtime()
    HuaweiImportController(r.appContext, r.syncStore) { emit("onHuaweiImportProgress", it) }
  }

  AsyncFunction("importHuaweiExport") Coroutine { uri: String, password: String ->
    withContext(Dispatchers.IO) { controller.run(uri, password) }
  }

  AsyncFunction("huaweiExportDisplayName") Coroutine { uri: String ->
    withContext(Dispatchers.IO) { controller.displayName(uri) }
  }

  Function("cancelHuaweiImport") {
    controller.cancel()
  }
}
