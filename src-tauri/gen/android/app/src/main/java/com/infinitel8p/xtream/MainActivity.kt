package com.infinitel8p.xtream

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {

  private var fullscreenView: View? = null
  private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
  private var originalSystemUi: Int = 0

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // After content is ready, find the WebView Tauri uses and attach a WebChromeClient.
    window.decorView.post {
      val webView = findFirstWebView(window.decorView)
      if (webView != null) {
        // Helpful while testing from Chrome DevTools:
        WebView.setWebContentsDebuggingEnabled(true)

        // Reasonable defaults (tweak as needed)
        webView.settings.javaScriptEnabled = true
        webView.settings.setSupportMultipleWindows(true)
        webView.settings.mediaPlaybackRequiresUserGesture = true

        webView.webChromeClient = object : WebChromeClient() {
          override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (fullscreenView != null) {
              callback.onCustomViewHidden()
              return
            }
            fullscreenView = view
            fullscreenCallback = callback

            val decor = window.decorView as FrameLayout
            originalSystemUi = decor.systemUiVisibility
            decor.addView(
              view,
              FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
              )
            )
            // Real fullscreen (immersive)
            decor.systemUiVisibility =
              (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
          }

          override fun onHideCustomView() {
            val decor = window.decorView as FrameLayout
            fullscreenView?.let { decor.removeView(it) }
            decor.systemUiVisibility = originalSystemUi
            fullscreenCallback?.onCustomViewHidden()
            fullscreenView = null
            fullscreenCallback = null
          }
        }
      }
    }

    // Back button exits fullscreen first, then falls back to default behavior
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (fullscreenView != null) {
            // Ask the current chrome client to hide the custom view
            val webView = findFirstWebView(window.decorView)
            (webView?.webChromeClient as? WebChromeClient)?.onHideCustomView()
          } else {
            // Disable this callback and delegate back press
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
          }
        }
      }
    )
  }

  /** Depth-first search for the first WebView in the activity’s view tree. */
  private fun findFirstWebView(root: View?): WebView? {
    when (root) {
      is WebView -> return root
      is ViewGroup -> {
        for (i in 0 until root.childCount) {
          val found = findFirstWebView(root.getChildAt(i))
          if (found != null) return found
        }
      }
    }
    return null
  }
}
