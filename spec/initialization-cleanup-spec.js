describe("folder-sync initialization cleanup", () => {
  let pack;

  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("folder-sync"))
      await lumine.packages.unloadPackage("folder-sync", { serialize: false });
    pack = lumine.packages.loadPackage("folder-sync");
    pack.initializeForExternalUse("workspace restoration");
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded("folder-sync"))
      await lumine.packages.unloadPackage("folder-sync", { serialize: false });
  });

  it("deactivates before activation and can activate again", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    expect(pack.mainActivationStarted).toBe(false);
    await expectAsync(pack.deactivate()).toBeResolved();
    expect(scope.disposed).toBe(true);
    pack = await lumine.packages.activatePackage("folder-sync");
    expect(pack.mainActivated).toBe(true);
    expect(pack.lifecycleContext.subscriptions).not.toBe(scope);
  });

  it("unloads before activation starts", async () => {
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivationStarted).toBe(false);
    await expectAsync(
      lumine.packages.unloadPackage("folder-sync", { serialize: false }),
    ).toBeResolved();
    expect(lumine.packages.isPackageLoaded("folder-sync")).toBe(false);
  });
});
