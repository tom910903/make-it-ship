// Make It Ship debug bridge: a tiny HTTP server on the device's loopback interface for QA.
// Endpoints: GET /healthz, GET /state (JSON from the app's provider), GET /screenshot (PNG of the key window).
#if DEBUG
import Foundation
import Network
import UIKit

public enum DebugBridge {
    public static let port: UInt16 = 8765
    private static var listener: NWListener?
    private static var stateProvider: () -> [String: Any] = { [:] }

    /// Call once from the app's init inside `#if DEBUG`.
    public static func start(state: @escaping () -> [String: Any] = { [:] }) {
        guard listener == nil else { return }
        stateProvider = state
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        guard let l = try? NWListener(using: params) else { return }
        l.newConnectionHandler = { conn in
            conn.start(queue: .main)
            conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                let line = data.flatMap { String(data: $0, encoding: .utf8) }?.split(separator: "\r\n").first ?? ""
                let path = line.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
                let (status, type, body) = respond(path)
                var head = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".data(using: .utf8)!
                head.append(body)
                conn.send(content: head, completion: .contentProcessed { _ in conn.cancel() })
            }
        }
        l.start(queue: .main)
        listener = l
    }

    public static func stop() { listener?.cancel(); listener = nil }

    private static func respond(_ path: String) -> (String, String, Data) {
        switch path {
        case "/healthz":
            return ("200 OK", "text/plain", Data("ok".utf8))
        case "/state":
            let json = (try? JSONSerialization.data(withJSONObject: stateProvider(), options: [.sortedKeys])) ?? Data("{}".utf8)
            return ("200 OK", "application/json", json)
        case "/screenshot":
            guard let png = screenshot() else { return ("503 Service Unavailable", "text/plain", Data("no window".utf8)) }
            return ("200 OK", "image/png", png)
        default:
            return ("404 Not Found", "text/plain", Data("not found".utf8))
        }
    }

    private static func screenshot() -> Data? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        guard let w = window else { return nil }
        return UIGraphicsImageRenderer(bounds: w.bounds).pngData { _ in w.drawHierarchy(in: w.bounds, afterScreenUpdates: false) }
    }
}
#endif
