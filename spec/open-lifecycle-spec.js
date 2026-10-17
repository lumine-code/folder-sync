const fs = require("node:fs").promises;
const path = require("node:path");

describe("Folder Sync external opening ownership", () => {
  it("does not use a replacement external opener after reading an old selection", async () => {
    const main = (await lumine.packages.activatePackage("folder-sync")).mainModule;
    const originalOpen = jasmine.createSpy("original external opener");
    const replacementOpen = jasmine.createSpy("replacement external opener");
    const edge = main.consumeOpenExternal({ openExternal: originalOpen });
    let finishRead;
    spyOn(main, "selectedPath").and.returnValue(path.join(__dirname, "fixtures", ".sync"));
    spyOn(fs, "readFile").and.returnValue(new Promise((resolve) => (finishRead = resolve)));

    const opening = main.open();
    edge.dispose();
    const replacement = main.consumeOpenExternal({ openExternal: replacementOpen });
    finishRead(JSON.stringify({ target: path.join(__dirname, "fixtures") }));
    await expectAsync(opening).toBeResolved();

    expect(originalOpen).not.toHaveBeenCalled();
    expect(replacementOpen).not.toHaveBeenCalled();
    replacement.dispose();
  });
});
