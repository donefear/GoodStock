import UIKit
import UniformTypeIdentifiers

/// Automatic backups into a folder the user picked once (iCloud Drive, On My iPhone, a USB drive…). The folder is
/// remembered as a security-scoped bookmark, so the app can keep writing goodstock-auto-backup-YYYY-MM-DD.json into
/// it; the newest four automatic backups are kept.
final class AutoBackup: NSObject, UIDocumentPickerDelegate {
    static let shared = AutoBackup()
    private static let bookmarkKey = "goodstock-auto-backup-folder"
    private static let prefix = "goodstock-auto-backup-"
    private static let keep = 4
    private var pickerCompletion: ((Result<String, Error>) -> Void)?

    enum Failure: LocalizedError {
        case cancelled, noFolder, notWritable
        var errorDescription: String? {
            switch self {
            case .cancelled: return "cancelled"
            case .noFolder: return "No backup folder chosen"
            case .notWritable: return "The backup could not be written"
            }
        }
    }

    func chooseFolder(from controller: UIViewController, completion: @escaping (Result<String, Error>) -> Void) {
        pickerCompletion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.delegate = self
        controller.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let folder = urls.first else { return finishPick(.failure(Failure.cancelled)) }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(bookmark, forKey: Self.bookmarkKey)
            finishPick(.success(folder.lastPathComponent))
        } catch {
            finishPick(.failure(error))
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishPick(.failure(Failure.cancelled))
    }

    private func finishPick(_ result: Result<String, Error>) {
        let completion = pickerCompletion
        pickerCompletion = nil
        completion?(result)
    }

    func forgetFolder() {
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
    }

    /// Writes one backup and removes all but the newest four automatic backups. Runs off the main thread.
    func write(fileName: String, content: String, completion: @escaping (Result<Void, Error>) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            do {
                guard let bookmark = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { throw Failure.noFolder }
                var stale = false
                let folder = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
                guard folder.startAccessingSecurityScopedResource() else { throw Failure.notWritable }
                defer { folder.stopAccessingSecurityScopedResource() }
                if stale, let fresh = try? folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
                }
                let safeName = fileName.replacingOccurrences(of: "/", with: "-")
                var writeError: Error?
                var coordinatorError: NSError?
                NSFileCoordinator().coordinate(writingItemAt: folder.appendingPathComponent(safeName), options: .forReplacing, error: &coordinatorError) { target in
                    do { try Data(content.utf8).write(to: target, options: .atomic) } catch { writeError = error }
                }
                if let error = writeError ?? coordinatorError { throw error }
                let backups = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                    .filter { $0.lastPathComponent.hasPrefix(Self.prefix) }
                    .sorted { $0.lastPathComponent > $1.lastPathComponent }
                for old in backups.dropFirst(Self.keep) { try? FileManager.default.removeItem(at: old) }
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
        }
    }
}
