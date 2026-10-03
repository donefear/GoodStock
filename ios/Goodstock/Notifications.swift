import Foundation
import UserNotifications

/// Timer alarms and use-soon reminders. iOS suspends the page when the app is in the background, so every running
/// timer is also scheduled as a local notification for the moment it ends; the page sends the full list
/// ({id, endsAt, done, title, text}, texts already in the app's language) whenever it changes, and timers that
/// disappear from it are cancelled, including one that is showing.
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    private let center = UNUserNotificationCenter.current()
    private static let timerPrefix = "goodstock-timer-"

    func isAllowed(_ completion: @escaping (Bool) -> Void) {
        center.getNotificationSettings { settings in
            completion([.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus))
        }
    }

    func requestPermission(_ completion: @escaping (Bool) -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted { return completion(true) }
            self.isAllowed(completion)
        }
    }

    func showReminder(title: String, text: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = text
        content.sound = .default
        center.add(UNNotificationRequest(identifier: "goodstock-reminder", content: content, trigger: nil))
    }

    func syncTimers(json: String) {
        let list = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] ?? []
        let now = Date().timeIntervalSince1970
        var wanted: [String: UNNotificationRequest] = [:]
        var known = Set<String>()
        for timer in list {
            guard let id = timer["id"] as? String, let endsAt = (timer["endsAt"] as? NSNumber)?.doubleValue else { continue }
            let identifier = Self.timerPrefix + id
            known.insert(identifier)
            if (timer["done"] as? Bool) == true { continue }
            let content = UNMutableNotificationContent()
            content.title = timer["title"] as? String ?? "⏰"
            content.body = timer["text"] as? String ?? ""
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            let seconds = max(1, endsAt / 1000 - now)
            wanted[identifier] = UNNotificationRequest(identifier: identifier, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))
        }
        center.getPendingNotificationRequests { pending in
            let pendingIds = Set(pending.map(\.identifier))
            let stale = pendingIds.filter { $0.hasPrefix(Self.timerPrefix) && wanted[$0] == nil }
            self.center.removePendingNotificationRequests(withIdentifiers: Array(stale))
            // Only add new or changed timers (+1 min changes the end time), so unchanged ones keep their schedule.
            for (identifier, request) in wanted where !pendingIds.contains(identifier) || self.endChanged(identifier, request, pending) {
                self.center.add(request)
            }
        }
        center.getDeliveredNotifications { delivered in
            let gone = delivered.map(\.request.identifier).filter { $0.hasPrefix(Self.timerPrefix) && !known.contains($0) }
            self.center.removeDeliveredNotifications(withIdentifiers: gone)
        }
    }

    private func endChanged(_ identifier: String, _ request: UNNotificationRequest, _ pending: [UNNotificationRequest]) -> Bool {
        guard let old = pending.first(where: { $0.identifier == identifier })?.trigger as? UNTimeIntervalNotificationTrigger,
              let oldDate = old.nextTriggerDate(),
              let newDate = (request.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate() else { return true }
        return abs(oldDate.timeIntervalSince(newDate)) > 2
    }

    // With the app open, the page rings its own alarm for timers; reminders still show as a banner.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if notification.request.identifier.hasPrefix(Self.timerPrefix) { return completionHandler([]) }
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
