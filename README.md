# folder-sync

One-way folder synchronization from the tree view.

Copies new or changed files to the target and removes files that no longer exist in the source.

## Features

- **One-way sync**: copies only new or changed files to target.
- **Auto cleanup**: removes files from target that no longer exist in source.
- **Ignore extensions**: skip specific file types during sync.
- **Open target**: uses the `open-external` service to open the target folder.

## Installation

To install `folder-sync` search for _folder-sync_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/folder-sync`.

## Commands

Commands available in `.tree-view`:

- `folder-sync:create`: create a `.sync` config in the selected folder,
- `folder-sync:run`: run sync using the selected `.sync` file,
- `folder-sync:open`: open the target folder in the file manager.

## Usage

1. Right-click a folder in tree-view and run `folder-sync:create`.
2. Edit the `.sync` config file with your target path.
3. Right-click the `.sync` file and run `folder-sync:run`.

## Configuration

The `.sync` file is a JSON config. Use `target` for an absolute path:

```json
{
  "target": "C:/Backup/MyFolder",
  "ignoreExts": ["log", "tmp"]
}
```

Or use `name` with the `storagePath` package setting; the target is built as `storagePath/name`:

```json
{
  "name": "MyFolder",
  "ignoreExts": ["log", "tmp"]
}
```

Options:

- `target`: absolute destination path,
- `name`: folder name inside `storagePath`,
- `ignoreExts`: file extensions to ignore (optional).

## Services

- **tree-view.selection** (`^1.0.0`): consumed to read the selected entries that the commands operate on.
- **open-external** (`^1.0.0`): consumed to open the sync target folder in the system file manager.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
