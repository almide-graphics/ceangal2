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
    var runLogPath: String { dir + "/run.log" }
    var appName: String { ProcessInfo.processInfo.environment["E2E_APP"] ?? "playground" }

    override func setUp() { continueAfterFailure = false }

    func launch(fresh: Bool = true, url: String = "") {
        try? FileManager.default.removeItem(atPath: a11yPath)
        try? FileManager.default.removeItem(atPath: guiPath)
        try? FileManager.default.removeItem(atPath: runLogPath)
        try? FileManager.default.removeItem(atPath: runLogPath + ".end")
        let data = dir + "/data"
        if fresh { try? FileManager.default.removeItem(atPath: data) }
        app = XCUIApplication()
        app.launchEnvironment = [
            "CEANGAL_A11Y": "1", "CEANGAL_A11Y_LOG": a11yPath, "CEANGAL_GUI_A11Y": guiPath,
            "CEANGAL_DATA_DIR": data, "CEANGAL_SECRETS": "file", "CEANGAL_LAUNCH": url,
            "CEANGAL_RUN_LOG": runLogPath,
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

    /// Type on the on-screen keyboard, key by key, then Return (unless
    /// `enter` is false).
    func type(_ text: String, enter: Bool = true) {
        let kb = app.keyboards.firstMatch
        XCTAssertTrue(kb.waitForExistence(timeout: 10), "no on-screen keyboard")
        // a fresh simulator's first keyboard can show an introduction panel
        for name in ["Continue", "Not Now", "OK"] {
            let b = app.buttons[name]
            if b.exists { b.tap(); Thread.sleep(forTimeInterval: 0.5) }
        }
        for (i, ch) in text.enumerated() {
            if !kb.exists { shot("fail-keyboard-gone"); XCTFail("the keyboard went away after \(i) keys; labels: \(labels(tree()))") }
            let s = String(ch)
            if s == " " { kb.keys["space"].tap(); continue }
            var key = kb.keys[s]
            var tries = 0
            while !key.waitForExistence(timeout: 1) && tries < 3 {
                // the other case: Shift switches the letters
                // (named "shift" or "Shift" depending on the iOS version)
                let shift = [kb.buttons["shift"], kb.keys["shift"], kb.buttons["Shift"], kb.keys["Shift"]].first { $0.exists }
                if let shift { shift.tap() } else { Thread.sleep(forTimeInterval: 0.5) }
                key = kb.keys[s]
                tries += 1
            }
            if !key.exists {
                shot("fail-key-\(s)")
                XCTFail("no key \"\(s)\" on the keyboard; keys: \(kb.keys.allElementsBoundByIndex.map(\.label).joined(separator: " "))")
            }
            key.tap()
        }
        if enter {
            let ret = kb.buttons["Return"].exists ? kb.buttons["Return"] : kb.keys["Return"]
            ret.tap()
        }
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

    // The edit every platform makes (tests/lib/fixtures.mjs EDIT_TODO_KEYS):
    // symbols from the key bar, words from the keyboard.
    let editKeys: [(String, String)] = [
        ("bar", "{"), ("keys", " id"), ("bar", ":"), ("keys", " next"), ("bar", "_"), ("keys", "id "), ("bar", "+"),
        ("keys", " next"), ("bar", "_"), ("keys", "id"), ("bar", ","), ("keys", " title"), ("bar", ":"), ("keys", " "),
        ("bar", "\""), ("keys", "Edited"), ("bar", "\""), ("bar", ","), ("keys", " done"), ("bar", ":"), ("keys", " false "),
        ("bar", "}"), ("bar", ","), ("keys", " "),
    ]

    func test3_todoExampleEditedAsWindow() {
        guard appName == "playground" else { return }
        launch(url: "https://play.almide.dev/?example=todo")
        let t0 = until("the playground", timeout: 30, has("Code editor"))
        // a tap at the top of the source raises the keyboard and the key bar;
        // six lines down (the first task); a new task typed in front of it
        let ed = node(t0, "Code editor")!
        tapAt(ed.x + 4, ed.y + 16)
        until("the key bar over the keyboard", has("Key bar"))
        shot("keybar")
        for _ in 0..<6 { tap("Down arrow") }
        for (how, text) in editKeys {
            if how == "bar" { tap("Insert " + text) } else { type(text, enter: false) }
        }
        let edit = editKeys.map(\.1).joined().trimmingCharacters(in: .whitespaces)
        until("the edit in the editor") { t in (self.node(t, "Code editor")?.value ?? "").contains(edit) }
        // a tap outside the editor puts the keyboard away: the action bar is back
        tap("Almide")
        until("the Run button", has("Run"))
        tap("Run")
        until("the program window", timeout: 90, has("Program window"))
        untilGui("the edited program") { g in g.contains { $0.label == "Edited" } && g.contains { $0.label == "2 tasks left" } }
        tapGui("New task")
        type("Buy milk")
        // the edited example starts with two tasks open: Buy milk makes three, done again two
        untilGui("the program to add the task") { g in g.contains { $0.label == "Remove Buy milk" } && g.contains { $0.label == "3 tasks left" } }
        tapGui("Buy milk")
        untilGui("the program to toggle the task") { g in g.contains { $0.label == "2 tasks left" } }
        shot("gui")
        tap("Stop")
        until("Stop") { t in !self.has("Program window")(t) }
    }

    /// The old playground's fixtures and every console example, compiled and
    /// run on the device; stdout compared with the CLI's (fixtures.json).
    func test4_fixtures() throws {
        guard appName == "playground" else { return }
        struct Fx: Decodable { let id: String; let link: String; let want: String? }
        let list = try JSONDecoder().decode([Fx].self, from: Data(contentsOf: URL(fileURLWithPath: dir + "/fixtures.json")))
        var bad: [String] = []
        for p in list {
            launch(fresh: false, url: p.link)
            let end = Date().addingTimeInterval(90)
            var result: String? = nil
            while Date() < end {
                if let r = try? String(contentsOfFile: runLogPath + ".end", encoding: .utf8) { result = r; break }
                Thread.sleep(forTimeInterval: 0.3)
            }
            guard let r = result else { bad.append("\(p.id): no result"); continue }
            if !r.hasPrefix("200 ") || !r.contains("\"exitCode\":0") { bad.append("\(p.id): \(r.prefix(200))"); continue }
            let out = (try? String(contentsOfFile: runLogPath, encoding: .utf8)) ?? ""
            let trimmed = out.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
            if let want = p.want, trimmed != want { bad.append("\(p.id): drift") }
        }
        XCTAssertTrue(bad.isEmpty, bad.joined(separator: "; "))
    }
}

/// tests/apps/services: what VoiceOver sees, the system clipboard (checked
/// from outside with `simctl pbpaste`), the share sheet for a saved file,
/// the document picker.
final class ServicesE2E: E2E {
    func test1_clipboardShareSheetPicker() {
        guard appName == "services" else { return }
        launch()
        until("the app", has("Copy"))
        // VoiceOver's view of the app (AccessKit's UIKit adapter): buttons and text
        XCTAssertTrue(app.buttons["Copy"].waitForExistence(timeout: 10), "VoiceOver does not see the Copy button: \(app.debugDescription)")
        XCTAssertTrue(app.staticTexts["no file"].exists || app.otherElements["no file"].exists || app.descendants(matching: .any)["no file"].exists,
                      "VoiceOver does not see the text \"no file\": \(app.debugDescription)")
        tap("Copy")
        shot("copied")

        tap("Export")
        // the share sheet is the system's (a remote view): tap above it to
        // close it, and the app hears "cancelled"
        let sheet = app.otherElements["ActivityListView"].firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 10), "no share sheet")
        Thread.sleep(forTimeInterval: 1)
        shot("share-sheet")
        tapAt(app.frame.width / 2, 120)
        until("the cancelled save", has("file 499 "))

        tap("Open")
        let cancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), "no document picker")
        shot("picker")
        cancel.tap()
        until("the cancelled open", has("file 499 "))
    }
}
