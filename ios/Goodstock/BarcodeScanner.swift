import AVFoundation
import UIKit

/// A full-screen camera that reads one product barcode (EAN-13, EAN-8, UPC-E) and closes. Uses the system's own
/// barcode detection, so no extra library is needed.
final class BarcodeScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private var finished = false
    private let completion: (Result<String, Error>) -> Void
    private let cancelTitle: String

    enum Failure: LocalizedError {
        case cancelled, noCamera
        var errorDescription: String? { self == .cancelled ? "cancelled" : "The camera is not available" }
    }

    init(cancelTitle: String, completion: @escaping (Result<String, Error>) -> Void) {
        self.cancelTitle = cancelTitle
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
            return finish(.failure(Failure.noCamera))
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return finish(.failure(Failure.noCamera)) }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.ean13, .ean8, .upce].filter { output.availableMetadataObjectTypes.contains($0) }

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.layer.bounds
        view.layer.addSublayer(preview)

        // A guide box in the middle, and a cancel button.
        let guide = UIView()
        guide.layer.borderColor = UIColor.white.cgColor
        guide.layer.borderWidth = 3
        guide.layer.cornerRadius = 12
        guide.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(guide)
        let cancel = UIButton(type: .system)
        cancel.setTitle(cancelTitle, for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = .systemFont(ofSize: 20, weight: .semibold)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            guide.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            guide.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            guide.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.8),
            guide.heightAnchor.constraint(equalTo: guide.widthAnchor, multiplier: 0.5),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        ])
        DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { $0.frame = view.layer.bounds }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        finish(.success(code))
    }

    @objc private func cancelTapped() { finish(.failure(Failure.cancelled)) }

    private func finish(_ result: Result<String, Error>) {
        guard !finished else { return }
        finished = true
        if session.isRunning { session.stopRunning() }
        let done = completion
        if presentingViewController != nil {
            dismiss(animated: true) { done(result) }
        } else {
            DispatchQueue.main.async { done(result) }
        }
    }
}
