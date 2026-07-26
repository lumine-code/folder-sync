const { CompositeDisposable, Disposable } = require("atom");
const path = require("path");
const fs = require("fs").promises;

module.exports = {
  activate() {
    this.treeView = null;
    this.openExternal = null;
    this.disposables = new CompositeDisposable(
      atom.commands.add(".tree-view", {
        "folder-sync:create": () => this.create(),
        "folder-sync:run": () => this.run(),
        "folder-sync:open": () => this.open(),
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
  },

  consumeTreeView(treeView) {
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

  getTargetPath(config) {
    if (config.target) return config.target;
    if (config.name) {
      const storagePath = atom.config.get("folder-sync.storagePath");
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
    if (!this.treeView) return;
    const dPath = this.treeView.selectedPaths()[0];
    if (!dPath) {
      atom.notifications.addError("tree-view does not return path!");
      return;
    }
    if (!(await fs.lstat(dPath)).isDirectory()) {
      atom.notifications.addError("Selected item is not directory", {
        detail: dPath,
      });
      return;
    }
    const [pPath] = atom.project.relativizePath(dPath);
    const name = path.basename(pPath).replace(/\\/g, "/");
    const configPath = path.join(dPath, ".sync");
    if (await this.exists(configPath)) {
      atom.notifications.addError(".sync already exists", { detail: configPath });
      return;
    }
    await fs.writeFile(configPath, `{\n  "name": "${name}"\n}`);
  },

  async run() {
    if (!this.treeView) return;
    const configPath = this.treeView.selectedPaths()[0];
    if (path.basename(configPath) !== ".sync") {
      atom.notifications.addError("File is not valid .sync", {
        detail: configPath,
      });
      return;
    }
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (err) {
      atom.notifications.addError("Failed to parse .sync file", {
        detail: err.message,
      });
      return;
    }
    const dstDir = this.getTargetPath(config);
    if (!dstDir) {
      atom.notifications.addError("Missing target or name in config");
      return;
    }
    const ignoreExts = config.ignoreExts || [];
    const srcDir = path.dirname(configPath);

    atom.notifications.addInfo("Folder sync started...", {
      detail: `src: ${srcDir}\ndst: ${dstDir}`,
    });

    try {
      const copied = await this.syncDir(srcDir, dstDir, ignoreExts);
      const deleted = await this.deleteExtras(srcDir, dstDir, ignoreExts);
      if (copied || deleted) {
        atom.notifications.addSuccess(`Folder synced (copied: ${copied}, deleted: ${deleted})`);
      } else {
        atom.notifications.addSuccess("Nothing to sync");
      }
    } catch (err) {
      atom.notifications.addError("Sync failed", { detail: err.message });
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
    if (!this.treeView || !this.openExternal) return;
    const configPath = this.treeView.selectedPaths()[0];
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (err) {
      atom.notifications.addError("Failed to parse config file", {
        detail: err.message,
      });
      return;
    }
    const targetPath = this.getTargetPath(config);
    if (!targetPath) {
      atom.notifications.addError("Missing target or name in config");
      return;
    }
    this.openExternal.openExternal(targetPath);
  },
};
