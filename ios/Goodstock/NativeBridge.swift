import AudioToolbox
import UIKit
import UserNotifications
import WebKit

/// The phone features the web app uses in the standalone apps: window.GoodstockNative, the same methods as
/// android/…/NativeBridge.java. WebKit only passes messages one way, so a small script (installed before the page
/// loads) turns each call into a message, and answers come back through window.__goodstockNativeCallback(id, ok,
/// payload). notificationsAllowed() must answer at once, so the native side keeps its value up to date in the page.
final class NativeBridge: NSObject, WKScriptMessageHandler {
    private weak var controller: WebViewController?
    private var notificationsAllowed = false
    private var pendingSave: (id: String, file: URL)?
    private lazy var http = PhoneHTTP()

    init(controller: WebViewController) {
        self.controller = controller
        super.init()
    }

    func install(in content: WKUserContentController) {
        content.add(WeakMessageHandler(self), name: "goodstock")
        let shim = Self.shim.replacingOccurrences(of: "__CAN_SCAN__", with: UIImagePickerController.isSourceTypeAvailable(.camera) ? "true" : "false")
        content.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        refreshNotificationPermission()
    }

    private static let shim = """
    (function () {
      var state = { notificationsAllowed: false };
      window.__goodstockNativeState = state;
      function post(method, args) { window.webkit.messageHandlers.goodstock.postMessage({ method: method, args: args }); }
      window.GoodstockNative = {
        platform: 'ios',
        setTimers: function (json) { post('setTimers', [String(json)]); },
        notify: function (title, text) { post('notify', [String(title), String(text)]); },
        setReminders: function (json) { post('setReminders', [String(json)]); },
        notificationsAllowed: function () { return state.notificationsAllowed; },
        requestNotifications: function (id) { post('requestNotifications', [id]); },
        keepScreenOn: function (on) { post('keepScreenOn', [on ? 'true' : 'false']); },
        vibrate: function (ms) { post('vibrate', [String(ms)]); },
        share: function (text) { post('share', [String(text)]); },
        fetchPage: function (id, url) { post('fetchPage', [id, String(url)]); },
        httpRequest: function (id, url, headers) { post('httpRequest', [id, String(url), String(headers || '{}')]); },
        httpSend: function (id, method, url, headers, body) { post('httpSend', [id, String(method), String(url), String(headers || '{}'), String(body)]); },
        saveFile: function (id, name, content) { post('saveFile', [id, String(name), String(content)]); },
        canScanBarcodes: function () { return __CAN_SCAN__; },
        scanBarcode: function (id) { post('scanBarcode', [id]); }
      };
      // Tell the app the page's language (i18n.js sets html lang), for the confirm dialog buttons.
      function sendLanguage() { post('language', [document.documentElement.lang || 'en']); }
      new MutationObserver(sendLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let args = (body["args"] as? [Any])?.map { "\($0)" } ?? []
        let arg = { (index: Int) -> String in index < args.count ? args[index] : "" }
        switch method {
        case "language":
            controller?.pageLanguage = arg(0)
        case "setTimers":
            Notifications.shared.syncTimers(json: arg(0))
        case "setReminders":
            Notifications.shared.syncReminders(json: arg(0))
        case "notify":
            Notifications.shared.showReminder(title: arg(0), text: arg(1))
        case "requestNotifications":
            Notifications.shared.requestPermission { granted in
                self.setNotificationsAllowed(granted)
                self.callback(arg(0), ok: true, payload: granted ? "granted" : "denied")
            }
        case "keepScreenOn":
            UIApplication.shared.isIdleTimerDisabled = arg(0) == "true"
        case "vibrate":
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        case "share":
            share(arg(0))
        case "fetchPage":
            request(id: arg(0), method: "GET", address: arg(1), headers: "{}", body: nil)
        case "httpRequest":
            request(id: arg(0), method: "GET", address: arg(1), headers: arg(2), body: nil)
        case "httpSend":
            request(id: arg(0), method: arg(1), address: arg(2), headers: arg(3), body: arg(4))
        case "scanBarcode":
            scanBarcode(id: arg(0))
        case "saveFile":
            saveFile(id: arg(0), name: arg(1), content: arg(2))
        default:
            break
        }
    }

    func refreshNotificationPermission() {
        Notifications.shared.isAllowed { self.setNotificationsAllowed($0) }
    }

    private func setNotificationsAllowed(_ allowed: Bool) {
        DispatchQueue.main.async {
            self.notificationsAllowed = allowed
            self.controller?.webView.evaluateJavaScript("window.__goodstockNativeState && (window.__goodstockNativeState.notificationsAllowed = \(allowed))", completionHandler: nil)
        }
    }

    // The page reloads after a crash, which installs the script again with "false"; send the real value once loaded.
    func pageDidLoad() { setNotificationsAllowed(notificationsAllowed) }

    private func request(id: String, method: String, address: String, headers: String, body: String?) {
        http.send(method: method, address: address, headersJSON: headers, body: body) { result in
            switch result {
            case .success(let json): self.callback(id, ok: true, payload: json)
            case .failure(let error): self.callback(id, ok: false, payload: error.localizedDescription)
            }
        }
    }

    private func share(_ text: String) {
        guard let controller else { return }
        let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        // On iPad the sheet is a popover and needs an anchor.
        sheet.popoverPresentationController?.sourceView = controller.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
        sheet.popoverPresentationController?.permittedArrowDirections = []
        controller.present(sheet, animated: true)
    }

    /// A product barcode from the camera, for adding groceries. Answers with the number, or "cancelled".
    private func scanBarcode(id: String) {
        guard let controller else { return callback(id, ok: false, payload: "cancelled") }
        let scanner = BarcodeScannerViewController(cancelTitle: DialogLabels.cancel(controller.pageLanguage)) { result in
            switch result {
            case .success(let code): self.callback(id, ok: true, payload: code)
            case .failure(let error): self.callback(id, ok: false, payload: error.localizedDescription)
            }
        }
        controller.present(scanner, animated: true)
    }

    /// The kitchen backup: written to a temporary file, then the user picks where to keep it (Files, iCloud Drive…).
    private func saveFile(id: String, name: String, content: String) {
        guard let controller else { return callback(id, ok: false, payload: "cancelled") }
        let safeName = name.replacingOccurrences(of: "/", with: "-")
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(safeName.isEmpty ? "goodstock-backup.json" : safeName)
        do {
            try Data(content.utf8).write(to: file, options: .atomic)
        } catch {
            return callback(id, ok: false, payload: "The backup could not be written")
        }
        pendingSave = (id, file)
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        picker.delegate = self
        controller.present(picker, animated: true)
    }

    private func finishSave(saved: Bool) {
        guard let pending = pendingSave else { return }
        pendingSave = nil
        try? FileManager.default.removeItem(at: pending.file)
        callback(pending.id, ok: saved, payload: saved ? "saved" : "cancelled")
    }

    private func callback(_ id: String, ok: Bool, payload: String) {
        guard let arguments = try? JSONSerialization.data(withJSONObject: [id, ok, payload] as [Any]),
              let list = String(data: arguments, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.controller?.webView.evaluateJavaScript("window.__goodstockNativeCallback && window.__goodstockNativeCallback.apply(null, \(list))", completionHandler: nil)
        }
    }
}

extension NativeBridge: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishSave(saved: true) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishSave(saved: false) }
}

/// WKUserContentController keeps its handlers alive; this keeps the bridge (and the page) from never being freed.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
