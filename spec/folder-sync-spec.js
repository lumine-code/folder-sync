const fs = require("fs");
const os = require("os");
const path = require("path");

describe("folder-sync", () => {
  let workspaceElement, mainModule, tempDir, srcDir, dstDir, selected;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    ({ mainModule } = await lumine.packages.activatePackage("folder-sync"));

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
    const commands = lumine.commands
      .findCommands({ target: treeView })
      .map((command) => command.name);
    expect(commands).toContain("folder-sync:create");
    expect(commands).toContain("folder-sync:run");
    expect(commands).toContain("folder-sync:open");
  });

  describe("folder-sync:create", () => {
    it("creates a .sync config named after the project root", async () => {
      lumine.project.setPaths([srcDir]);
      selected = [lumine.project.getPaths()[0]];
      await mainModule.create();

      const configPath = path.join(selected[0], ".sync");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.name).toBe(path.basename(selected[0]));
    });

    it("refuses to overwrite an existing .sync", async () => {
      lumine.project.setPaths([srcDir]);
      selected = [lumine.project.getPaths()[0]];
      writeSyncConfig({ name: "existing" });
      spyOn(lumine.notifications, "addError");
      await mainModule.create();

      expect(lumine.notifications.addError).toHaveBeenCalled();
      const config = JSON.parse(fs.readFileSync(path.join(selected[0], ".sync"), "utf8"));
      expect(config.name).toBe("existing");
    });
  });

  describe("folder-sync:run", () => {
    for (const target of ["same", "ancestor", "new-child", "existing-child"]) {
      it(`refuses a ${target} target before copying or deleting anything`, async () => {
        const targetPath =
          target === "same"
            ? srcDir
            : target === "ancestor"
              ? tempDir
              : path.join(srcDir, "backup");
        if (target === "existing-child") fs.mkdirSync(targetPath);
        const sourceFile = path.join(srcDir, "keep.txt");
        fs.writeFileSync(sourceFile, "keep");
        selected = [writeSyncConfig({ target: targetPath })];
        spyOn(mainModule, "syncDir");
        spyOn(mainModule, "deleteExtras");
        spyOn(lumine.notifications, "addError");

        await mainModule.run();

        expect(mainModule.syncDir).not.toHaveBeenCalled();
        expect(mainModule.deleteExtras).not.toHaveBeenCalled();
        expect(lumine.notifications.addError).toHaveBeenCalledWith("Sync failed", {
          detail: "Source and target folders must be separate; neither can contain the other.",
        });
        expect(fs.readFileSync(sourceFile, "utf8")).toBe("keep");
        if (target === "new-child") expect(fs.existsSync(targetPath)).toBe(false);
      });
    }

    it("resolves symlink ancestors before checking a new target", async () => {
      const aliasPath = path.join(tempDir, "source-alias");
      fs.symlinkSync(srcDir, aliasPath, process.platform === "win32" ? "junction" : "dir");
      const targetPath = path.join(aliasPath, "new", "backup");
      selected = [writeSyncConfig({ target: targetPath })];
      spyOn(mainModule, "syncDir");
      spyOn(mainModule, "deleteExtras");
      spyOn(lumine.notifications, "addError");

      await mainModule.run();

      expect(mainModule.syncDir).not.toHaveBeenCalled();
      expect(mainModule.deleteExtras).not.toHaveBeenCalled();
      expect(lumine.notifications.addError).toHaveBeenCalled();
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("allows a sibling whose name starts with the source folder name", async () => {
      const targetPath = `${srcDir}-backup`;
      fs.writeFileSync(path.join(srcDir, "keep.txt"), "keep");
      selected = [writeSyncConfig({ target: targetPath })];

      await mainModule.run();

      expect(fs.readFileSync(path.join(targetPath, "keep.txt"), "utf8")).toBe("keep");
    });

    it("refuses a nested target junction before writing outside the target", async () => {
      const outsideDir = path.join(tempDir, "outside");
      fs.mkdirSync(outsideDir);
      const outsideFile = path.join(outsideDir, "keep.txt");
      fs.writeFileSync(outsideFile, "original");
      fs.mkdirSync(path.join(srcDir, "nested"));
      fs.writeFileSync(path.join(srcDir, "nested", "keep.txt"), "replacement");
      fs.mkdirSync(dstDir);
      fs.symlinkSync(
        outsideDir,
        path.join(dstDir, "nested"),
        process.platform === "win32" ? "junction" : "dir",
      );
      selected = [writeSyncConfig({ target: dstDir })];
      spyOn(mainModule, "syncDir");
      spyOn(mainModule, "deleteExtras");
      spyOn(lumine.notifications, "addError");

      await mainModule.run();

      expect(mainModule.syncDir).not.toHaveBeenCalled();
      expect(mainModule.deleteExtras).not.toHaveBeenCalled();
      expect(lumine.notifications.addError).toHaveBeenCalled();
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("original");
    });

    it("allows a top-level target alias to a separate directory", async () => {
      fs.mkdirSync(dstDir);
      const aliasPath = path.join(tempDir, "target-alias");
      fs.symlinkSync(dstDir, aliasPath, process.platform === "win32" ? "junction" : "dir");
      fs.writeFileSync(path.join(srcDir, "keep.txt"), "keep");
      selected = [writeSyncConfig({ target: aliasPath })];

      await mainModule.run();

      expect(fs.readFileSync(path.join(dstDir, "keep.txt"), "utf8")).toBe("keep");
    });

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
      lumine.config.set("folder-sync.storagePath", tempDir);
      fs.writeFileSync(path.join(srcDir, "a.txt"), "alpha");
      selected = [writeSyncConfig({ name: "by-name" })];

      await mainModule.run();

      expect(fs.readFileSync(path.join(tempDir, "by-name", "a.txt"), "utf8")).toBe("alpha");
    });

    it("rejects a selection that is not a .sync file", async () => {
      const other = path.join(srcDir, "not-sync.json");
      fs.writeFileSync(other, "{}");
      selected = [other];
      spyOn(lumine.notifications, "addError");

      await mainModule.run();

      expect(lumine.notifications.addError).toHaveBeenCalled();
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
