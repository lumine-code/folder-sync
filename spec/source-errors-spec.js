const fs = require("fs");
const path = require("node:path");
const os = require("node:os");

describe("Folder Sync source availability safety", () => {
  let main, directory, source, target, config, previousStoragePath;
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("folder-sync")).mainModule;
    previousStoragePath = lumine.config.get("folder-sync.storagePath");
    directory = fs.mkdtempSync(path.join(temporaryRoot, "folder-source-control-"));
    source = path.join(directory, "source");
    target = path.join(directory, "target");
    fs.mkdirSync(source);
    fs.mkdirSync(target);
    config = path.join(source, ".sync");
    fs.writeFileSync(config, JSON.stringify({ target }));
    main.consumeTreeViewSelection({ selectedPaths: () => [config] });
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("folder-sync");
    if (previousStoragePath === undefined) lumine.config.unset("folder-sync.storagePath");
    else lumine.config.set("folder-sync.storagePath", previousStoragePath);
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith("folder-source-control-")
    ) {
      throw new Error("Refuse cleanup outside the owned temporary directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("keeps real destination data when the source existence check returns EACCES", async () => {
    const sourceFile = path.join(source, "keep.txt"),
      targetFile = path.join(target, "keep.txt");
    fs.writeFileSync(sourceFile, "valuable mirrored data");
    fs.writeFileSync(targetFile, "valuable mirrored data");
    const access = fs.promises.access.bind(fs.promises);
    const canonicalSource = await fs.promises.realpath(sourceFile);
    const key = (file) =>
      process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
    let injected = 0;
    const check = spyOn(fs.promises, "access").and.callFake((file, ...args) => {
      if (key(file) === key(canonicalSource)) {
        injected++;
        return Promise.reject(
          Object.assign(new Error("Source permission unavailable"), { code: "EACCES" }),
        );
      }
      return access(file, ...args);
    });
    const error = spyOn(lumine.notifications, "addError");

    await main.run();

    expect(check).withContext(JSON.stringify(check.calls.allArgs())).toHaveBeenCalled();
    expect(injected)
      .withContext(JSON.stringify({ canonicalSource, calls: check.calls.allArgs() }))
      .toBeGreaterThan(0);
    expect(fs.existsSync(targetFile)).toBe(true);
    if (fs.existsSync(targetFile))
      expect(fs.readFileSync(targetFile, "utf8")).toBe("valuable mirrored data");
    expect(error).toHaveBeenCalledWith("Sync failed", { detail: "Source permission unavailable" });
  });

  it("refuses a documented absolute-target violation before any copy or cleanup", async () => {
    fs.writeFileSync(config, JSON.stringify({ target: "folder-relative-control-do-not-create" }));
    const copy = spyOn(main, "syncDir").and.resolveTo(0);
    const cleanup = spyOn(main, "deleteExtras").and.resolveTo(0);
    const error = spyOn(lumine.notifications, "addError");

    await main.run();

    expect(copy).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  for (const mode of ["relative-storage", "escaping-name"]) {
    it(`refuses ${mode} before touching any target`, async () => {
      lumine.config.set(
        "folder-sync.storagePath",
        mode === "relative-storage"
          ? "folder-relative-storage-control-do-not-create"
          : path.join(directory, "storage"),
      );
      fs.writeFileSync(
        config,
        JSON.stringify({ name: mode === "escaping-name" ? "../escaped" : "backup" }),
      );
      const copy = spyOn(main, "syncDir").and.resolveTo(0);
      const cleanup = spyOn(main, "deleteExtras").and.resolveTo(0);
      const error = spyOn(lumine.notifications, "addError");

      await main.run();

      expect(copy).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });
  }
});
