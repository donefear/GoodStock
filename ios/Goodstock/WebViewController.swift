import SafariServices
import UIKit
import WebKit

/// Shows the bundled web app. Files are served from the app bundle's "web" folder at goodstock://app/, a fixed origin
/// so the page's localStorage (the whole kitchen) survives updates, and ES modules load as they do on a server.
final class WebViewController: UIViewController {
    static let scheme = "goodstock"
    static let startURL = URL(string: "goodstock://app/index.html")!

    private(set) var webView: WKWebView!
    private var bridge: NativeBridge!
    /// The page's language (html lang), so the confirm and alert buttons match it.
    var pageLanguage = "en"

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAssetHandler(), forURLScheme: Self.scheme)
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        bridge = NativeBridge(controller: self)
        bridge.install(in: configuration.userContentController)

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "Paper")
        webView.scrollView.backgroundColor = UIColor(named: "Paper")
        webView.allowsLinkPreview = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: Self.startURL))
        NotificationCenter.default.addObserver(self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// Back in the app: catch up on timers that ended while it was suspended, and on use-soon reminders.
    @objc private func appWillEnterForeground() {
        bridge.refreshNotificationPermission()
        webView.evaluateJavaScript("window.goodstockResume && window.goodstockResume()", completionHandler: nil)
    }

    /// Opens a web address outside the app: in an in-app Safari sheet for web pages, otherwise with the system.
    func openExternally(_ url: URL) {
        if url.scheme == "http" || url.scheme == "https" {
            present(SFSafariViewController(url: url), animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if url.scheme == Self.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        // Recipe sources, Mealie, DeepL and YouTube links leave the app.
        if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame?.isMainFrame != false {
            openExternally(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        bridge.pageDidLoad()
    }

    /// iOS may stop the page's process under memory pressure; start it again rather than show a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: Self.startURL))
    }
}

extension WebViewController: WKUIDelegate {
    /// Links with target="_blank" ask for a new window; open them outside the app instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openExternally(url) }
        return nil
    }

    // window.alert and window.confirm (deleting a recipe, clearing the list, restoring a backup) need native dialogs.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: DialogLabels.ok(pageLanguage), style: .default) { _ in completionHandler() })
        presentDialog(alert, otherwise: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: DialogLabels.cancel(pageLanguage), style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: DialogLabels.ok(pageLanguage), style: .default) { _ in completionHandler(true) })
        presentDialog(alert) { completionHandler(false) }
    }

    /// The page waits until the dialog is answered, so answer it even when the dialog cannot be shown.
    private func presentDialog(_ alert: UIAlertController, otherwise fallback: @escaping () -> Void) {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { return fallback() }
        present(alert, animated: true)
    }
}

/// OK and Cancel in the app's languages (see i18n.js).
enum DialogLabels {
    private static let labels: [String: (ok: String, cancel: String)] = [
        "en": ("OK", "Cancel"), "nl": ("OK", "Annuleren"), "es": ("Aceptar", "Cancelar"), "fr": ("OK", "Annuler"),
        "de": ("OK", "Abbrechen"), "it": ("OK", "Annulla"), "pt": ("OK", "Cancelar"), "ru": ("ОК", "Отмена"),
        "zh": ("好", "取消"), "ja": ("OK", "キャンセル"), "ro": ("OK", "Anulează"), "pl": ("OK", "Anuluj"), "tr": ("Tamam", "İptal"),
    ]
    static func ok(_ language: String) -> String { labels[language]?.ok ?? "OK" }
    static func cancel(_ language: String) -> String { labels[language]?.cancel ?? "Cancel" }
}

/// Serves the bundled web files. Only files inside the bundle's "web" folder can be read.
final class WebAssetHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8", "webmanifest": "application/manifest+json",
        "svg": "image/svg+xml", "png": "image/png", "woff2": "font/woff2",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(response)
            task.didReceive(Data("Not found".utf8))
            return task.didFinish()
        }
        let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
