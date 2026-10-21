import AVFoundation
import UIKit
import UserNotifications

/// Goodstock for iPhone and iPad: the web app from the repository root, bundled and run in a web view with no server,
/// like the Android APK. Data lives only on the device; Settings → Back up saves a copy.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = Notifications.shared
        // Timer beeps play through the web page's audio; .playback keeps them audible with the silent switch on,
        // and mixing leaves music or a podcast playing.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
