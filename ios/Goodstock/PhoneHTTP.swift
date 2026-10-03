import Foundation

/// Web requests made by the phone instead of the page: recipe pages to import, Mealie and DeepL. Unlike the page's
/// own fetch they are not limited by CORS. Answers with JSON {status, url, body}, like the Android app.
final class PhoneHTTP: NSObject, URLSessionTaskDelegate {
    private static let maxBytes = 5_000_000
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 40
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    enum Failure: LocalizedError {
        case badAddress, tooLarge
        var errorDescription: String? {
            switch self {
            case .badAddress: return "Only http and https links are supported"
            case .tooLarge: return "That page is too large"
            }
        }
    }

    func send(method: String, address: String, headersJSON: String, body: String?, completion: @escaping (Result<String, Error>) -> Void) {
        guard let url = URL(string: address), url.scheme == "http" || url.scheme == "https" else {
            return completion(.failure(Failure.badAddress))
        }
        var request = URLRequest(url: url)
        request.httpMethod = method.isEmpty ? "GET" : method.uppercased()
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X) GoodstockRecipeImport/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        let headers = (try? JSONSerialization.jsonObject(with: Data(headersJSON.utf8))) as? [String: Any] ?? [:]
        for (name, value) in headers { request.setValue("\(value)", forHTTPHeaderField: name) }
        if let body { request.httpBody = Data(body.utf8) }

        session.dataTask(with: request) { data, response, error in
            if let error { return completion(.failure(error)) }
            guard let response = response as? HTTPURLResponse else { return completion(.failure(URLError(.badServerResponse))) }
            let bytes = data ?? Data()
            if bytes.count > Self.maxBytes { return completion(.failure(Failure.tooLarge)) }
            let result: [String: Any] = [
                "status": response.statusCode,
                "url": response.url?.absoluteString ?? address,
                "body": Self.text(bytes, encodingName: response.textEncodingName),
            ]
            guard let json = try? JSONSerialization.data(withJSONObject: result), let text = String(data: json, encoding: .utf8) else {
                return completion(.failure(URLError(.cannotDecodeContentData)))
            }
            completion(.success(text))
        }.resume()
    }

    private static func text(_ data: Data, encodingName: String?) -> String {
        if let name = encodingName {
            let encoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
            if encoding != kCFStringEncodingInvalidId,
               let text = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(encoding))) {
                return text
            }
        }
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }

    /// Redirects: never forward a key (like the Mealie token) to another host, and never re-send a request body.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest else { return completionHandler(request) }
        if original.httpBody != nil { return completionHandler(nil) }
        var next = request
        if next.url?.host?.lowercased() != original.url?.host?.lowercased() {
            next.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(next)
    }
}
