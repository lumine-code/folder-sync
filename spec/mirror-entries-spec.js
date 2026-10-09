const fs = require("fs");
const os = require("os");
const path = require("path");

describe("Folder sync mirror entries", () => {
  let root, source, target, main;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      spyOn(lumine.shell, method).and.resolveTo();
    }
    spyOn(lumine.application, "openWindow").and.resolveTo();
    ({ mainModule: main } = await lumine.packages.activatePackage("folder-sync"));
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-sync-mirror-")));
    source = path.join(root, "source");
    target = path.join(root, "target");
    fs.mkdirSync(source);
    fs.mkdirSync(target);
    const config = path.join(source, ".sync");
    fs.writeFileSync(config, JSON.stringify({ target, ignoreExts: ["log"] }));
    main.consumeTreeViewSelection({ selectedPaths: () => [config] });
    spyOn(lumine.notifications, "addError");
  });

  afterEach(() => {
    if (!root) return;
    const temporary = fs.realpathSync(os.tmpdir());
    const relative = path.relative(temporary, fs.realpathSync(root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Fixture cleanup must remain inside its owned temporary directory.");
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("preserves ignored descendants when their source directory disappears", async () => {
    fs.mkdirSync(path.join(target, "old", "nested"), { recursive: true });
    fs.writeFileSync(path.join(target, "old", "nested", "keep.log"), "private log");
    fs.writeFileSync(path.join(target, "old", "nested", "stale.txt"), "obsolete");
    await main.run();
    const log = path.join(target, "old", "nested", "keep.log");
    expect(fs.existsSync(log)).toBe(true);
    if (fs.existsSync(log)) expect(fs.readFileSync(log, "utf8")).toBe("private log");
    expect(fs.existsSync(path.join(target, "old", "nested", "stale.txt"))).toBe(false);
    expect(lumine.notifications.addError).not.toHaveBeenCalled();
  });

  it("replaces an obsolete target file with the source directory", async () => {
    fs.mkdirSync(path.join(source, "entry"));
    fs.writeFileSync(path.join(source, "entry", "new.txt"), "new child");
    fs.writeFileSync(path.join(target, "entry"), "old file");
    await main.run();
    const child = path.join(target, "entry", "new.txt");
    expect(fs.existsSync(child)).toBe(true);
    if (fs.existsSync(child)) expect(fs.readFileSync(child, "utf8")).toBe("new child");
    expect(lumine.notifications.addError).not.toHaveBeenCalled();
  });

  it("replaces an obsolete target directory with the source file", async () => {
    fs.writeFileSync(path.join(source, "entry"), "new file");
    fs.mkdirSync(path.join(target, "entry"));
    fs.writeFileSync(path.join(target, "entry", "old.txt"), "old child");
    await main.run();
    const entry = path.join(target, "entry");
    expect(fs.statSync(entry).isFile()).toBe(true);
    if (fs.statSync(entry).isFile()) expect(fs.readFileSync(entry, "utf8")).toBe("new file");
    expect(lumine.notifications.addError).not.toHaveBeenCalled();
  });

  it("preserves ignored files that prevent replacing a target directory", async () => {
    fs.writeFileSync(path.join(source, "entry"), "new file");
    fs.mkdirSync(path.join(target, "entry"));
    const log = path.join(target, "entry", "keep.log");
    fs.writeFileSync(log, "private log");
    await main.run();
    expect(fs.readFileSync(log, "utf8")).toBe("private log");
    expect(fs.readFileSync(path.join(source, "entry"), "utf8")).toBe("new file");
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });

  it("preserves an ignored target file that conflicts with a source directory", async () => {
    fs.mkdirSync(path.join(source, "entry.log"));
    fs.writeFileSync(path.join(source, "entry.log", "new.txt"), "new child");
    const log = path.join(target, "entry.log");
    fs.writeFileSync(log, "private log");
    await main.run();
    expect(fs.readFileSync(log, "utf8")).toBe("private log");
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });

  it("keeps target data when a source symlink points to a directory", async () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(
      outside,
      path.join(source, "entry"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.mkdirSync(path.join(target, "entry"));
    const kept = path.join(target, "entry", "keep.txt");
    fs.writeFileSync(kept, "target data");
    await main.run();
    expect(fs.existsSync(kept)).toBe(true);
    if (fs.existsSync(kept)) expect(fs.readFileSync(kept, "utf8")).toBe("target data");
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });
});
