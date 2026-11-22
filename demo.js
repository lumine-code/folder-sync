// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["tree-view", "language-json", "notifications"],
  viewport: { width: 1150, height: 520 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open, project } = context;
    lumine.config.set("folder-sync.storagePath", project);
    require("node:fs").mkdirSync(fixture("sync-output"), { recursive: true });
    state.editor = await open("sync-source/.sync");
    await lumine.project.setPaths([fixture("sync-source")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Synchronize a sample folder and see the result in the editor.",
      timeout: 60000,
      allowNotifications: true,
      async run(context) {
        const { lumine, state, waitFor } = context;
        const folderSync = lumine.packages.getActivePackage("folder-sync").mainModule;
        lumine.commands.dispatch(state.editor.getElement(), "tree-view:reveal-active-file");
        await waitFor(
          () => folderSync.treeView?.selectedPaths()[0] === state.editor.getPath(),
          "tree selection for the sync configuration",
        );
        await folderSync.run();
        document.querySelector("lumine-notification.success")?.click();
        for (const notice of document.querySelectorAll("lumine-notification.hint")) {
          if (notice.querySelector(".message")?.textContent.trim() === "Folder sync started...") {
            notice.click();
            notice.querySelector(".close")?.click();
          }
        }
      },
      ready(context) {
        const { fixture, project } = context;
        const visibleText = document.body.innerText;
        return Boolean(
          require("node:fs").existsSync(fixture("sync-output/samples.csv")) &&
          document
            .querySelector("lumine-notification.success")
            ?.innerText.includes("Folder synced") &&
          !visibleText.includes(project) &&
          !/[a-z]:[\\/]/i.test(visibleText),
        );
      },
    },
  ],
  async cleanup() {},
};
