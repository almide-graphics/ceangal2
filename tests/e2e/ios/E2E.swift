// The iOS apps in the simulator, driven like a user: taps at the boxes the
// app reports for its accessibility nodes, typing on the on-screen keyboard,
// Home and back. The app writes its tree to a file (CEANGAL_A11Y_LOG, the
// text the Android E2E reads from logcat); the playground also writes the
// tree of the program it runs (CEANGAL_GUI_A11Y).
//
// tools/package_ios.sh <app> e2e runs these (tests/e2e/ios.mjs drives it).
import XCTest

struct Node { let role: Int; let x, y, w, h: Double; let label, value: String }
struct Tree { let scale: Double; let nodes: [Node] }

class E2E: XCTestCase {
    var app: XCUIApplication!
    let dir = ProcessInfo.processInfo.environment["E2E_DIR"] ?? NSTemporaryDirectory()
    var a11yPath: String { dir + "/a11y.txt" }
    var guiPath: String { dir + "/gui.txt" }
    var appName: String { ProcessInfo.processInfo.environment["E2E_APP"] ?? "playground" }

    override func setUp() { continueAfterFailure = false }

    func launch(fresh: Bool = true, url: String = "") {
        try? FileManager.default.removeItem(atPath: a11yPath)
        try? FileManager.default.removeItem(atPath: guiPath)
        let data = dir + "/data"
        if fresh { try? FileManager.default.removeItem(atPath: data) }
        app = XCUIApplication()
        app.launchEnvironment = [
            "CEANGAL_A11Y": "1", "CEANGAL_A11Y_LOG": a11yPath, "CEANGAL_GUI_A11Y": guiPath,
            "CEANGAL_DATA_DIR": data, "CEANGAL_SECRETS": "file", "CEANGAL_LAUNCH": url,
        ]
        app.launch()
    }

    func tree() -> Tree? {
        guard let text = try? String(contentsOfFile: a11yPath, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let head = lines.first, head.hasPrefix("a11y-begin"), lines.last == "a11y-end" else { return nil }
        let scale = Double(head.split(separator: " ").last ?? "1") ?? 1
        let nodes = lines.dropFirst().dropLast().map { l -> Node in
            let f = l.split(separator: "\t", omittingEmptySubsequences: false).map(String.init) + Array(repeating: "", count: 8)
            return Node(role: Int(f[0]) ?? 0, x: Double(f[1]) ?? 0, y: Double(f[2]) ?? 0, w: Double(f[3]) ?? 0, h: Double(f[4]) ?? 0, label: f[6], value: f[7])
        }
        return Tree(scale: scale, nodes: nodes)
    }

    func guiTree() -> [Node] {
        guard let text = try? String(contentsOfFile: guiPath, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").map { l in
            let f = l.split(separator: "\t", omittingEmptySubsequences: false).map(String.init) + Array(repeating: "", count: 5)
            return Node(role: 0, x: Double(f[1]) ?? 0, y: Double(f[2]) ?? 0, w: Double(f[3]) ?? 0, h: Double(f[4]) ?? 0, label: f[0], value: "")
        }
    }

    func node(_ t: Tree?, _ label: String) -> Node? { t?.nodes.first { $0.label == label } }
    func has(_ label: String) -> (Tree) -> Bool { { t in t.nodes.contains { $0.label == label } } }
    func labels(_ t: Tree?) -> String { (t?.nodes ?? []).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ") }

    @discardableResult
    func until(_ what: String, timeout: TimeInterval = 20, _ pred: (Tree) -> Bool) -> Tree {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if let t = tree(), pred(t) { return t }
            Thread.sleep(forTimeInterval: 0.25)
        }
        shot("fail-\(what)")
        XCTFail("timed out waiting for \(what); labels: \(labels(tree()))")
        fatalError()
    }

    func untilGui(_ what: String, timeout: TimeInterval = 20, _ pred: ([Node]) -> Bool) {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if pred(guiTree()) { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        shot("fail-\(what)")
        XCTFail("timed out waiting for \(what); program labels: \(guiTree().map(\.label).joined(separator: " | "))")
    }

    /// Read a box until it stops moving (insets, the keyboard), then return it.
    func settled<T: Equatable>(_ what: String, _ read: () -> T?) -> T {
        var last: T? = nil
        for _ in 0..<25 {
            let r = read()
            if let r, r == last { return r }
            last = r
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("\(what) not found or kept moving")
        fatalError()
    }

    func tapAt(_ x: Double, _ y: Double) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
        Thread.sleep(forTimeInterval: 0.4)
    }

    func tap(_ label: String) {
        let c = settled("\"\(label)\"") { () -> [Double]? in
            guard let n = node(tree(), label) else { return nil }
            return [n.x + n.w / 2, n.y + n.h / 2]
        }
        tapAt(c[0], c[1])
    }

    func tapGui(_ label: String) {
        let c = settled("program node \"\(label)\"") { () -> [Double]? in
            guard let win = node(tree(), "Program window"), let n = guiTree().first(where: { $0.label == label }) else { return nil }
            return [win.x + n.x + n.w / 2, win.y + n.y + n.h / 2]
        }
        tapAt(c[0], c[1])
    }

    /// Type on the on-screen keyboard, key by key, then Return.
    func type(_ text: String) {
        let kb = app.keyboards.firstMatch
        XCTAssertTrue(kb.waitForExistence(timeout: 10), "no on-screen keyboard")
        for (i, ch) in text.enumerated() {
            if !kb.exists { shot("fail-keyboard-gone"); XCTFail("the keyboard went away after \(i) keys; labels: \(labels(tree()))") }
            let s = String(ch)
            if s == " " { kb.keys["space"].tap(); continue }
            var key = kb.keys[s]
            if !key.exists {
                // the other case: Shift switches the letters
                kb.buttons["shift"].firstMatch.tap()
                key = kb.keys[s]
            }
            XCTAssertTrue(key.waitForExistence(timeout: 3), "no key \"\(s)\" on the keyboard")
            key.tap()
        }
        let ret = kb.buttons["Return"].exists ? kb.buttons["Return"] : kb.keys["Return"]
        ret.tap()
        Thread.sleep(forTimeInterval: 0.4)
    }

    func swipe(_ x: Double, from y0: Double, to y1: Double) {
        let o = app.coordinate(withNormalizedOffset: .zero)
        o.withOffset(CGVector(dx: x, dy: y0)).press(forDuration: 0.05, thenDragTo: o.withOffset(CGVector(dx: x, dy: y1)), withVelocity: .default, thenHoldForDuration: 0.1)
        Thread.sleep(forTimeInterval: 0.9)
    }

    func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: dir + "/ios-\(appName)-\(name.replacingOccurrences(of: " ", with: "-")).png"))
    }
}

final class TodoE2E: E2E {
    func test1_startsAndRenders() {
        guard appName == "todo" else { return }
        launch()
        until("the New task field", has("New task"))
        shot("start")
    }

    func test2_typeToggleRemoveResume() {
        guard appName == "todo" else { return }
        launch()
        until("the New task field", has("New task"))
        tap("New task")
        type("Buy milk")
        until("the new task") { t in self.has("Buy milk")(t) && self.has("2 tasks left")(t) }
        shot("added")
        tap("Buy milk")
        until("1 task left", has("1 task left"))
        tap("Remove Buy milk")
        until("the task removed") { t in !self.has("Buy milk")(t) }

        // background / foreground: the surface is recreated
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        try? FileManager.default.removeItem(atPath: a11yPath)
        app.activate()
        let t = until("the app after resume", has("New task"))
        shot("resumed")

        // the content stays inside the safe area (status bar, home indicator)
        let screen = app.frame
        let named = t.nodes.filter { !$0.label.isEmpty }
        let top = named.map(\.y).min() ?? 0
        XCTAssertGreaterThanOrEqual(top, 44, "content starts at y=\(top) (under the status bar?)")
        let bottom = named.map { $0.y + $0.h }.max() ?? 0
        XCTAssertLessThanOrEqual(bottom, screen.height - 20, "content ends at y=\(bottom) (under the home indicator?)")
    }
}

final class PlaygroundE2E: E2E {
    func test1_runOnDevice() {
        guard appName == "playground" else { return }
        launch()
        until("the Run button", timeout: 30, has("Run"))
        shot("start")
        tap("Run")
        // the phone layout shows the program's output in the Output pane
        until("the program's output", timeout: 90) { t in t.nodes.contains { $0.label == "Features" } }
        shot("run")
    }

    func test2_examplesMenuScrolls() {
        guard appName == "playground" else { return }
        launch()
        until("the Run button", timeout: 30, has("Run"))
        tap("Examples")
        let m = node(until("the Examples menu", has("Examples menu")), "Examples menu")!
        for _ in 0..<6 {
            let now = tree()
            if let item = node(now, "Todo app"), let box = node(now, "Examples menu"),
               item.y + item.h <= box.y + box.h, item.y >= box.y { break }
            swipe(m.x + m.w / 2, from: m.y + m.h * 0.8, to: m.y + m.h * 0.2)
        }
        shot("examples")
        tap("Todo app")
        until("the Todo example in the editor") { t in (self.node(t, "Code editor")?.value ?? "").contains("ceangal") }
    }

    func test3_todoExampleAsWindow() {
        guard appName == "playground" else { return }
        launch(url: "https://play.almide.dev/?example=todo")
        until("the playground", timeout: 30, has("Run"))
        tap("Run")
        until("the program window", timeout: 90, has("Program window"))
        untilGui("the program's New task field") { g in g.contains { $0.label == "New task" } }
        tapGui("New task")
        type("Buy milk")
        // the example starts with one task open: Buy milk makes two, done again one
        untilGui("the program to add the task") { g in g.contains { $0.label == "Remove Buy milk" } && g.contains { $0.label == "2 tasks left" } }
        tapGui("Buy milk")
        untilGui("the program to toggle the task") { g in g.contains { $0.label == "1 task left" } }
        shot("gui")
        tap("Stop")
        until("Stop") { t in !self.has("Program window")(t) }
    }
}
