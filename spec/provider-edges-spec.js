const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
describe("Folder Sync independent provider edges", () => {
  let main, directory, config, leases;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    main = (await lumine.packages.activatePackage("folder-sync")).mainModule;
    directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "folder-sync-owned-edge-")),
    );
    config = path.join(directory, "owned.sync");
    await fs.writeFile(config, JSON.stringify({ target: directory }));
    leases = [];
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    await lumine.packages.deactivatePackage("folder-sync");
    await lumine.fileWatchClient.settlePendingTeardown();
    if (
      path.dirname(await fs.realpath(directory)) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(directory).startsWith("folder-sync-owned-edge-")
    )
      throw Error("Unsafe fixture cleanup");
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (const name of ["tree-view.selection", "open-external"]) {
    function offer(label) {
      const api =
        name === "tree-view.selection"
          ? { selectedPaths: jasmine.createSpy(label).and.returnValue([config]) }
          : { openExternal: jasmine.createSpy(label).and.resolveTo() };
      const lease = lumine.packages.serviceHub.provide(name, "1.0.0", api);
      leases.push(lease);
      return { api, lease };
    }
    for (const withdrawal of ["older", "newer", "none"]) {
      it(`opens the configured target after ${withdrawal} ${name} edge withdraws`, async () => {
        const other = name === "tree-view.selection" ? "open-external" : "tree-view.selection";
        leases.push(
          lumine.packages.serviceHub.provide(
            other,
            "1.0.0",
            other === "open-external"
              ? { openExternal: jasmine.createSpy("other").and.resolveTo() }
              : { selectedPaths: () => [config] },
          ),
        );
        const older = offer("older"),
          newer = offer("newer");
        if (withdrawal !== "none") (withdrawal === "older" ? older : newer).lease.dispose();
        await main.open();
        const expected = withdrawal === "newer" ? older : newer;
        if (name === "tree-view.selection")
          expect(expected.api.selectedPaths).toHaveBeenCalledTimes(1);
        else expect(expected.api.openExternal).toHaveBeenCalledOnceWith(directory);
      });
    }
  }
});
