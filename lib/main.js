const { CompositeDisposable, Disposable } = require("lumine");
const path = require("path");
const fs = require("fs").promises;

// Resolve existing ancestors too: a new target below a symlink must be checked
// against the real source before mkdir or the first copy changes anything.
async function resolveDirectoryPath(directoryPath) {
  try {
    return await fs.realpath(directoryPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parentPath = path.dirname(directoryPath);
    const basename = path.basename(directoryPath);
    if (parentPath === directoryPath || basename === "..") throw error;
    return path.join(await resolveDirectoryPath(parentPath), basename);
  }
}

function containsDirectory(parentPath, directoryPath) {
  const relativePath = path.relative(parentPath, directoryPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

async function validateTargetEntries(directoryPath) {
  let entries;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Target contains a symbolic link that could redirect synchronization: ${entryPath}`,
      );
    }
    if (entry.isDirectory()) await validateTargetEntries(entryPath);
  }
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "folder-sync",
      tips: [
        "You can mirror a project folder to another location with {{ 'folder-sync:open' | keystroke }}",
      ],
    };
  },

  activate() {
    this.treeView = null;
    this.openExternal = null;
    this.disposables = new CompositeDisposable(
      // On the workspace: the tree view is inside it, so the context menu
      // reaches these on its own, and Packages > Folder Sync — which dispatches
      // at whatever holds focus — reaches them too. On .tree-view all three
      // menu items did nothing unless the tree view happened to have focus.
      lumine.commands.add("lumine-workspace", {
        "folder-sync:create": {
          description: "Set up a new folder pair to keep in step.",
          didDispatch: () => this.create(),
        },
        "folder-sync:run": {
          description: "Copy the changed files between the configured folders.",
          didDispatch: () => this.run(),
        },
        "folder-sync:open": {
          description: "Open the file that configures the folder pairs.",
          didDispatch: () => this.open(),
        },
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      this.treeView = null;
    });
  },

  consumeOpenExternal(service) {
    this.openExternal = service;
    return new Disposable(() => {
      this.openExternal = null;
    });
  },

  // The tree view's first selected path, or null with a reason. Every command
  // here needs one, and none of them is dispatched only from the tree view any
  // more — an empty selection used to reach path.basename(undefined).
  selectedPath() {
    const selected = this.treeView?.selectedPaths?.()[0];
    if (!selected) {
      lumine.notifications.addWarning("folder-sync: nothing selected", {
        detail: "Select a folder or a .sync file in the tree view first.",
      });
      return null;
    }
    return selected;
  },

  getTargetPath(config) {
    if (config.target) return config.target;
    if (config.name) {
      const storagePath = lumine.config.get("folder-sync.storagePath");
      if (storagePath) return path.join(storagePath, config.name);
    }
    return null;
  },

  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },

  async create() {
    const dPath = this.selectedPath();
    if (!dPath) return;
    if (!(await fs.lstat(dPath)).isDirectory()) {
      lumine.notifications.addError("Selected item is not directory", {
        detail: dPath,
      });
      return;
    }
    const [pPath] = lumine.project.relativizePath(dPath);
    const name = path.basename(pPath).replace(/\\/g, "/");
    const configPath = path.join(dPath, ".sync");
    if (await this.exists(configPath)) {
      lumine.notifications.addError(".sync already exists", { detail: configPath });
      return;
    }
    await fs.writeFile(configPath, `{\n  "name": "${name}"\n}`);
  },

  async run() {
    const configPath = this.selectedPath();
    if (!configPath) return;
    if (path.basename(configPath) !== ".sync") {
      lumine.notifications.addError("File is not valid .sync", {
        detail: configPath,
      });
      return;
    }
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (err) {
      lumine.notifications.addError("Failed to parse .sync file", {
        detail: err.message,
      });
      return;
    }
    const dstDir = this.getTargetPath(config);
    if (!dstDir) {
      lumine.notifications.addError("Missing target or name in config");
      return;
    }
    const ignoreExts = config.ignoreExts || [];
    const srcDir = path.dirname(configPath);

    try {
      const [sourcePath, targetPath] = await Promise.all([
        resolveDirectoryPath(srcDir),
        resolveDirectoryPath(dstDir),
      ]);
      if (containsDirectory(sourcePath, targetPath) || containsDirectory(targetPath, sourcePath)) {
        throw new Error(
          "Source and target folders must be separate; neither can contain the other.",
        );
      }
      await validateTargetEntries(targetPath);
      lumine.notifications.addHint("Folder sync started...", {
        detail: `src: ${srcDir}\ndst: ${dstDir}`,
      });
      const copied = await this.syncDir(sourcePath, targetPath, ignoreExts);
      const deleted = await this.deleteExtras(sourcePath, targetPath, ignoreExts);
      if (copied || deleted) {
        lumine.notifications.addSuccess(`Folder synced (copied: ${copied}, deleted: ${deleted})`);
      } else {
        lumine.notifications.addSuccess("Nothing to sync");
      }
    } catch (err) {
      lumine.notifications.addError("Sync failed", { detail: err.message });
    }
  },

  async syncDir(srcDir, dstDir, ignoreExts) {
    let copied = 0;
    await fs.mkdir(dstDir, { recursive: true });
    const items = await fs.readdir(srcDir, { withFileTypes: true });

    for (const item of items) {
      if (item.name === ".sync") continue;
      const srcPath = path.join(srcDir, item.name);
      const dstPath = path.join(dstDir, item.name);

      if (item.isDirectory()) {
        copied += await this.syncDir(srcPath, dstPath, ignoreExts);
      } else {
        if (ignoreExts.includes(path.extname(item.name).substring(1))) continue;
        if (await this.exists(dstPath)) {
          const srcData = await fs.readFile(srcPath);
          const dstData = await fs.readFile(dstPath);
          if (srcData.equals(dstData)) continue;
        }
        await fs.copyFile(srcPath, dstPath);
        copied++;
      }
    }
    return copied;
  },

  async deleteExtras(srcDir, dstDir, ignoreExts) {
    let deleted = 0;
    const dstItems = await fs.readdir(dstDir, { withFileTypes: true });

    for (const item of dstItems) {
      const srcPath = path.join(srcDir, item.name);
      const dstPath = path.join(dstDir, item.name);

      if (!item.isDirectory() && ignoreExts.includes(path.extname(item.name).substring(1))) {
        continue;
      }

      const srcExists = await this.exists(srcPath);

      if (item.isDirectory()) {
        if (srcExists) {
          deleted += await this.deleteExtras(srcPath, dstPath, ignoreExts);
        } else {
          await fs.rm(dstPath, { recursive: true });
          deleted++;
        }
      } else if (!srcExists) {
        await fs.rm(dstPath);
        deleted++;
      }
    }
    return deleted;
  },

  async open() {
    if (!this.openExternal) return;
    const configPath = this.selectedPath();
    if (!configPath) return;
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (err) {
      lumine.notifications.addError("Failed to parse config file", {
        detail: err.message,
      });
      return;
    }
    const targetPath = this.getTargetPath(config);
    if (!targetPath) {
      lumine.notifications.addError("Missing target or name in config");
      return;
    }
    this.openExternal.openExternal(targetPath);
  },
};
