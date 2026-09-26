import SwiftUI
import AVFoundation

/// 相机权限门控：未授权时显示空态说明 + 跳转设置，避免静默黑屏。
/// 同时用 NavigationStack 包装扫描器，提供导航栏关闭按钮。
struct QRScannerGate: View {
    var onResult: (String) -> Void
    var onCancel: () -> Void
    @State private var status = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        NavigationStack {
            Group {
                switch status {
                case .authorized:
                    QRScannerView(onResult: onResult, onCancel: onCancel)
                        .ignoresSafeArea()
                case .notDetermined:
                    ProgressView().onAppear {
                        AVCaptureDevice.requestAccess(for: .video) { granted in
                            DispatchQueue.main.async {
                                status = granted ? .authorized : .denied
                            }
                        }
                    }
                case .denied, .restricted:
                    VxinEmptyState(
                        icon: "camera",
                        title: "无法使用相机",
                        subtitle: "请在系统设置中允许投聊访问相机，才能扫描二维码",
                        isError: true,
                        actionTitle: "去设置",
                        action: {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                    )
                @unknown default:
                    VxinEmptyState(icon: "camera", title: "相机不可用", isError: true)
                }
            }
            .navigationTitle("扫一扫")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onCancel() }
                }
            }
        }
    }
}

/// 基于 AVFoundation 的二维码扫描器。扫到结果回调一次后即停止。
struct QRScannerView: UIViewControllerRepresentable {
    var onResult: (String) -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> ScannerVC {
        let vc = ScannerVC()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: ScannerVC, context: Context) {}

    final class Coordinator: NSObject, ScannerVCDelegate {
        let parent: QRScannerView
        init(_ parent: QRScannerView) { self.parent = parent }
        func didScan(_ value: String) { parent.onResult(value) }
        func didCancel() { parent.onCancel() }
    }
}

protocol ScannerVCDelegate: AnyObject {
    func didScan(_ value: String)
    func didCancel()
}

final class ScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    weak var delegate: ScannerVCDelegate?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var handled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupCamera()

        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            cancel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
        ])

        let hint = UILabel()
        hint.text = "将二维码放入框内即可扫描"
        hint.textColor = .white
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)
        NSLayoutConstraint.activate([
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
        ])
    }

    private func setupCamera() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.layer.bounds
        view.layer.insertSublayer(layer, at: 0)
        preview = layer
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.startRunning() }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.layer.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    @objc private func cancelTapped() { delegate?.didCancel() }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !handled,
              let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = obj.stringValue else { return }
        handled = true
        session.stopRunning()
        delegate?.didScan(value)
    }
}
