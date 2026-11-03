package expo.modules.pdfpages

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// Opens a PDF inside the app with Android's own PdfRenderer (API 21+) — no library, no
// external reader app (RC.1 QA: a lab report needed Adobe Reader to be read at all).
// Each page is drawn to a PNG in the cache and handed back as a file:// URI, so the
// existing photo viewer (pinch-zoom, share) shows it like any picture.
class PdfPagesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfPages")

    AsyncFunction("render") { uri: String, width: Int, maxPages: Int ->
      val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "No Android context", null)
      val parsed = Uri.parse(uri)
      val descriptor: ParcelFileDescriptor = when (parsed.scheme) {
        "content" -> context.contentResolver.openFileDescriptor(parsed, "r")
        else -> ParcelFileDescriptor.open(File(parsed.path ?: uri), ParcelFileDescriptor.MODE_READ_ONLY)
      } ?: throw CodedException("NO_FILE", "Could not open the PDF", null)

      val outDir = File(context.cacheDir, "pdf-pages/${uri.hashCode()}")
      outDir.mkdirs()
      val pages = mutableListOf<String>()
      var total = 0
      descriptor.use { fd ->
        PdfRenderer(fd).use { renderer ->
          total = renderer.pageCount
          val count = minOf(total, maxPages.coerceAtLeast(1))
          for (index in 0 until count) {
            val file = File(outDir, "page-$index-$width.png")
            if (!file.exists()) {
              renderer.openPage(index).use { page ->
                val w = width.coerceIn(320, 2400)
                val h = (page.height.toFloat() * w / page.width).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
                bitmap.recycle()
              }
            }
            pages.add(Uri.fromFile(file).toString())
          }
        }
      }
      mapOf("pages" to pages, "total" to total)
    }
  }
}
