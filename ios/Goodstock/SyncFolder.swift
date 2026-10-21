import UIKit
import UniformTypeIdentifiers

/// The shared folder for syncing without a server (see app/sync.js): a folder picked once (usually in iCloud Drive)
/// that keeps itself in step between the household's devices. Each device writes goodstock-sync-<device>.json and
/// reads the others'. Remembered as a security-scoped bookmark like AutoBackup; files iCloud has not downloaded yet
/// are asked for and picked up on the next sync.
final class SyncFolder: NSObject, UIDocumentPickerDelegate {
    static let shared = SyncFolder()
    private static let bookmarkKey = "goodstock-sync-folder"
    private static let pattern = try! NSRegularExpression(pattern: "^goodstock-sync-[\\w-]{4,64}\\.json$")
    private var pickerCompletion: ((Result<String, Error>) -> Void)?

    enum Failure: LocalizedError {
        case cancelled, noFolder, notReadable, notSyncFile
        var errorDescription: String? {
            switch self {
            case .cancelled: return "cancelled"
            case .noFolder: return "No shared folder chosen"
            case .notReadable: return "The shared folder could not be used"
            case .notSyncFile: return "Not a Goodstock sync file"
            }
        }
    }

    static func isSyncFile(_ name: String) -> Bool {
        pattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
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

    /// Runs `work` with the folder opened, off the main thread.
    private func inFolder(_ work: @escaping (URL) throws -> String, completion: @escaping (Result<String, Error>) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            do {
                guard let bookmark = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { throw Failure.noFolder }
                var stale = false
                let folder = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
                guard folder.startAccessingSecurityScopedResource() else { throw Failure.notReadable }
                defer { folder.stopAccessingSecurityScopedResource() }
                if stale, let fresh = try? folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
                }
                completion(.success(try work(folder)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    /// The sync files as JSON: [{name, modified, size}]. iCloud placeholders (".name.json.icloud") are downloaded.
    func list(completion: @escaping (Result<String, Error>) -> Void) {
        inFolder({ folder in
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
            let entries = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys)
            var files: [[String: Any]] = []
            for entry in entries {
                let name = entry.lastPathComponent
                if name.hasPrefix("."), name.hasSuffix(".icloud"), Self.isSyncFile(String(name.dropFirst().dropLast(7))) {
                    try? FileManager.default.startDownloadingUbiquitousItem(at: entry)
                    continue
                }
                guard Self.isSyncFile(name) else { continue }
                let values = try? entry.resourceValues(forKeys: Set(keys))
                files.append([
                    "name": name,
                    "modified": Int((values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000),
                    "size": values?.fileSize ?? 0,
                ])
            }
            let data = try JSONSerialization.data(withJSONObject: files)
            return String(data: data, encoding: .utf8) ?? "[]"
        }, completion: completion)
    }

    func read(name: String, completion: @escaping (Result<String, Error>) -> Void) {
        inFolder({ folder in
            guard Self.isSyncFile(name) else { throw Failure.notSyncFile }
            var text: String?
            var readError: Error?
            var coordinatorError: NSError?
            NSFileCoordinator().coordinate(readingItemAt: folder.appendingPathComponent(name), options: [], error: &coordinatorError) { source in
                do { text = try String(contentsOf: source, encoding: .utf8) } catch { readError = error }
            }
            if let error = readError ?? coordinatorError { throw error }
            guard let text else { throw Failure.notReadable }
            return text
        }, completion: completion)
    }

    func write(name: String, content: String, completion: @escaping (Result<String, Error>) -> Void) {
        inFolder({ folder in
            guard Self.isSyncFile(name) else { throw Failure.notSyncFile }
            var writeError: Error?
            var coordinatorError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: folder.appendingPathComponent(name), options: .forReplacing, error: &coordinatorError) { target in
                do { try Data(content.utf8).write(to: target, options: .atomic) } catch { writeError = error }
            }
            if let error = writeError ?? coordinatorError { throw error }
            return "saved"
        }, completion: completion)
    }
}
