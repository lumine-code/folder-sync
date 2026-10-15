const menu = require("../menus/main.json");

describe("Folder Sync menu scope", () => {
  it("offers configuration creation only on folder headers and retains sync-file actions", () => {
    const tree = document.createElement("div");
    tree.className = "tree-view";
    tree.innerHTML = `
      <ul class="full-menu">
        <li class="directory">
          <div class="list-item"><span class="name">Folder</span></div>
          <ul>
            <li class="file" data-name=".sync"><span class="name">.sync</span></li>
            <li class="file" data-name="other.txt"><span class="name">other.txt</span></li>
          </ul>
        </li>
      </ul>`;
    jasmine.attachToDOM(tree);
    const registration = lumine.contextMenu.add(menu["context-menu"]);
    const commands = (selector) =>
      lumine.contextMenu
        .templateForElement(tree.querySelector(selector))
        .map((item) => item.command)
        .filter((command) => command?.startsWith("folder-sync:"));
    try {
      expect(commands(".list-item .name")).toEqual(["folder-sync:create"]);
      expect(commands('[data-name=".sync"] .name')).toEqual([
        "folder-sync:run",
        "folder-sync:open",
      ]);
      expect(commands('[data-name="other.txt"] .name')).toEqual([]);
    } finally {
      registration.dispose();
      tree.remove();
    }
  });
});
