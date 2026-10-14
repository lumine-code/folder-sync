// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["tree-view", "language-json", "notifications"],
  viewport: { width: 1150, height: 520 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(fixture("sync-source/.sync"), "utf8"));
    config.target = fixture("sync-output");
    fs.mkdirSync(config.target, { recursive: true });
    fs.writeFileSync(fixture("sync-source/.sync"), JSON.stringify(config, null, 2));
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
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(state.editor.getElement(), "tree-view:reveal-active-file");
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        {
          await lumine.packages.getActivePackage("folder-sync").mainModule.run();
        }
      },
      ready(context) {
        const { fixture } = context;
        return Boolean(
          require("fs").existsSync(fixture("sync-output/samples.csv")) &&
          document.querySelector("lumine-notification")?.innerText.includes("sync"),
        );
      },
    },
  ],
  async cleanup() {},
};
