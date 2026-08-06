const fs = require("fs");
const os = require("os");
const path = require("path");

describe("folder-sync", () => {
  let workspaceElement, mainModule, tempDir, srcDir, dstDir, selected;

  beforeEach(async () => {
    workspaceElement = atom.views.getView(atom.workspace);
    jasmine.attachToDOM(workspaceElement);
    ({ mainModule } = await atom.packages.activatePackage("folder-sync"));

    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-sync-spec-")));
    srcDir = path.join(tempDir, "source");
    dstDir = path.join(tempDir, "target");
    fs.mkdirSync(srcDir, { recursive: true });

    selected = [];
    mainModule.consumeTreeViewSelection({ selectedPaths: () => selected });
  });

  afterEach(() => {
    // Retries because Windows keeps a directory non-empty until the last handle on a child
    // closes, and `force` swallows only ENOENT.
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function writeSyncConfig(config) {
    const configPath = path.join(srcDir, ".sync");
    fs.writeFileSync(configPath, JSON.stringify(config));
    return configPath;
  }

  it("registers its commands", () => {
    const treeView = document.createElement("div");
    treeView.classList.add("tree-view");
    workspaceElement.appendChild(treeView);
    const commands = atom.commands
      .findCommands({ target: treeView })
      .map((command) => command.name);
    expect(commands).toContain("folder-sync:create");
    expect(commands).toContain("folder-sync:run");
    expect(commands).toContain("folder-sync:open");
  });

  describe("folder-sync:create", () => {
    it("creates a .sync config named after the project root", async () => {
      atom.project.setPaths([srcDir]);
      selected = [atom.project.getPaths()[0]];
      await mainModule.create();

      const configPath = path.join(selected[0], ".sync");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.name).toBe(path.basename(selected[0]));
    });

    it("refuses to overwrite an existing .sync", async () => {
      atom.project.setPaths([srcDir]);
      selected = [atom.project.getPaths()[0]];
      writeSyncConfig({ name: "existing" });
      spyOn(atom.notifications, "addError");
      await mainModule.create();

      expect(atom.notifications.addError).toHaveBeenCalled();
      const config = JSON.parse(fs.readFileSync(path.join(selected[0], ".sync"), "utf8"));
      expect(config.name).toBe("existing");
    });
  });

  describe("folder-sync:run", () => {
    it("copies new files to the target", async () => {
      fs.writeFileSync(path.join(srcDir, "a.txt"), "alpha");
      fs.mkdirSync(path.join(srcDir, "nested"));
      fs.writeFileSync(path.join(srcDir, "nested", "b.txt"), "beta");
      selected = [writeSyncConfig({ target: dstDir })];

      await mainModule.run();

      expect(fs.readFileSync(path.join(dstDir, "a.txt"), "utf8")).toBe("alpha");
      expect(fs.readFileSync(path.join(dstDir, "nested", "b.txt"), "utf8")).toBe("beta");
      expect(fs.existsSync(path.join(dstDir, ".sync"))).toBe(false);
    });

    it("removes target files that no longer exist in the source", async () => {
      fs.writeFileSync(path.join(srcDir, "keep.txt"), "keep");
      fs.mkdirSync(dstDir, { recursive: true });
      fs.writeFileSync(path.join(dstDir, "stale.txt"), "stale");
      fs.mkdirSync(path.join(dstDir, "stale-dir"));
      fs.writeFileSync(path.join(dstDir, "stale-dir", "c.txt"), "c");
      selected = [writeSyncConfig({ target: dstDir })];

      await mainModule.run();

      expect(fs.existsSync(path.join(dstDir, "keep.txt"))).toBe(true);
      expect(fs.existsSync(path.join(dstDir, "stale.txt"))).toBe(false);
      expect(fs.existsSync(path.join(dstDir, "stale-dir"))).toBe(false);
    });

    it("skips ignored extensions", async () => {
      fs.writeFileSync(path.join(srcDir, "app.js"), "code");
      fs.writeFileSync(path.join(srcDir, "debug.log"), "noise");
      selected = [writeSyncConfig({ target: dstDir, ignoreExts: ["log"] })];

      await mainModule.run();

      expect(fs.existsSync(path.join(dstDir, "app.js"))).toBe(true);
      expect(fs.existsSync(path.join(dstDir, "debug.log"))).toBe(false);
    });

    it("builds the target from storagePath and name", async () => {
      atom.config.set("folder-sync.storagePath", tempDir);
      fs.writeFileSync(path.join(srcDir, "a.txt"), "alpha");
      selected = [writeSyncConfig({ name: "by-name" })];

      await mainModule.run();

      expect(fs.readFileSync(path.join(tempDir, "by-name", "a.txt"), "utf8")).toBe("alpha");
    });

    it("rejects a selection that is not a .sync file", async () => {
      const other = path.join(srcDir, "not-sync.json");
      fs.writeFileSync(other, "{}");
      selected = [other];
      spyOn(atom.notifications, "addError");

      await mainModule.run();

      expect(atom.notifications.addError).toHaveBeenCalled();
      expect(fs.existsSync(dstDir)).toBe(false);
    });
  });

  describe("folder-sync:open", () => {
    it("opens the target through the open-external service", async () => {
      const openExternal = jasmine.createSpy("openExternal");
      mainModule.consumeOpenExternal({ openExternal });
      selected = [writeSyncConfig({ target: dstDir })];

      await mainModule.open();

      expect(openExternal).toHaveBeenCalledWith(dstDir);
    });

    it("clears the service when the provider is disposed", () => {
      const disposable = mainModule.consumeOpenExternal({ openExternal() {} });
      expect(mainModule.openExternal).not.toBeNull();
      disposable.dispose();
      expect(mainModule.openExternal).toBeNull();
    });
  });
});
