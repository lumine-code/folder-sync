const { CompositeDisposable } = require("lumine");
describe("Folder Sync command availability", () => {
  let main, target, leases, snapshot;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("folder-sync")).mainModule;
    target = document.createElement("div");
    target.className = "tree-view";
    lumine.workspace.getElement().appendChild(target);
    leases = new CompositeDisposable();
    snapshot = { count: 0, entries: [] };
    leases.add(
      main.consumeTreeViewSelection({
        getSelectionSnapshot: () => snapshot,
        selectedPaths: () => {
          throw Error("query materialized tree");
        },
      }),
    );
  });
  afterEach(() => {
    leases.dispose();
    target.remove();
  });
  it("distinguishes selected folders, sync configs and required external service", () => {
    const has = (id) => lumine.commands.canDispatch(target, "folder-sync:" + id);
    expect(has("create")).toBe(false);
    expect(has("run")).toBe(false);
    snapshot = { count: 1, entries: [{ path: "/project", kind: "directory" }] };
    expect(has("create")).toBe(true);
    expect(has("run")).toBe(false);
    snapshot = { count: 1, entries: [{ path: "/project/.sync", kind: "file" }] };
    expect(has("run")).toBe(true);
    expect(has("open")).toBe(false);
    leases.add(main.consumeOpenExternal({ openExternal() {} }));
    expect(has("open")).toBe(true);
  });
});
