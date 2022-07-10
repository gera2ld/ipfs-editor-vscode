import { IPFSHTTPClient, Options, create } from 'ipfs-http-client';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Entry extends vscode.FileStat {
  name: string;
}

export class IPFSProvider implements vscode.FileSystemProvider {
  private root: string;

  private logger?: vscode.OutputChannel;

  static create(
    ipfsOpts: Options,
    providerOpts?: {
      root?: string;
      logger?: vscode.OutputChannel;
    }
  ) {
    const ipfs = create(ipfsOpts);
    return new IPFSProvider(ipfs, providerOpts);
  }

  constructor(
    private ipfs: IPFSHTTPClient,
    providerOpts?: {
      root?: string;
      logger?: vscode.OutputChannel;
    }
  ) {
    this.root = providerOpts?.root ?? '/root';
    this.logger = providerOpts?.logger;
  }

  async close() {
    await this.resetRoot();
    this.ipfs = null;
  }

  private async resetRoot() {
    try {
      this.logger.appendLine('remove');
      await this.ipfs.files.rm(this.root, { recursive: true });
    } catch (err) {
      this.logger.appendLine('remove error: ' + err);
    }
  }

  async openFileOrDirectory(ipfsPath?: string) {
    if (ipfsPath) ipfsPath = await this.ipfs.resolve(ipfsPath);
    await this.resetRoot();
    const stat = ipfsPath && (await this.ipfs.files.stat(ipfsPath));
    this.logger.appendLine(ipfsPath);
    if (stat?.type === 'directory') {
      this.logger.appendLine('directory');
      await this.ipfs.files.cp(ipfsPath, this.root);
    } else {
      this.logger.appendLine('file');
      await this.ipfs.files.mkdir(this.root);
      if (ipfsPath) await this.ipfs.files.cp(ipfsPath, this.root + '/file');
    }
    const rootUri = vscode.Uri.parse('ipfs:' + this.root);
    this._fireSoon(
      {
        type: vscode.FileChangeType.Deleted,
        uri: rootUri,
      },
      {
        type: vscode.FileChangeType.Created,
        uri: rootUri,
      }
    );
    return this.getRootCid();
  }

  async getRootCid() {
    const stat = await this.ipfs.files.stat(this.root);
    return stat.cid.toString();
  }

  stat(uri: vscode.Uri) {
    this.logger.appendLine('stat ' + uri);
    return this._lookup(uri, false);
  }

  async readDirectory(uri: vscode.Uri) {
    this.logger.appendLine('readDir ' + uri);
    const fullPath = uri.path;
    const items: Array<[name: string, type: vscode.FileType]> = [];
    for await (const item of this.ipfs.files.ls(fullPath)) {
      items.push([
        item.name,
        item.type === 'directory'
          ? vscode.FileType.Directory
          : vscode.FileType.File,
      ]);
    }
    return items;
  }

  private mergeUint8Array(arrays: Uint8Array[]) {
    const length = arrays.reduce((prev, arr) => prev + arr.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const arr of arrays) {
      output.set(arr, offset);
      offset += arr.length;
    }
    return output;
  }

  async readFile(uri: vscode.Uri) {
    const fullPath = uri.path;
    try {
      const buffer = [];
      for await (const chunk of this.ipfs.files.read(fullPath)) {
        buffer.push(chunk);
      }
      return this.mergeUint8Array(buffer);
    } catch (err) {
      if (err?.code === 'ERR_NOT_FOUND') {
        throw vscode.FileSystemError.FileNotFound();
      }
      throw err;
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ) {
    const fullPath = uri.path;
    const entry = await this._lookup(uri, true);
    if (entry?.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    if (!options.overwrite && entry) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    try {
      await this.ipfs.files.write(fullPath, content, {
        create: options.create,
      });
    } catch (err) {
      if (err?.code === 'ERR_NO_EXIST') {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }
    if (!entry) {
      this._fireSoon({ type: vscode.FileChangeType.Created, uri });
    }
    this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ) {
    if (!options.overwrite && (await this._lookup(newUri, true))) {
      throw vscode.FileSystemError.FileExists(newUri);
    }
    const oldPath = oldUri.path;
    const newPath = newUri.path;
    await this.ipfs.files.mv(oldPath, newPath);

    this._fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    );
  }

  async delete(uri: vscode.Uri) {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const fullPath = uri.path;
    await this.ipfs.files.rm(fullPath, { recursive: true });
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { uri, type: vscode.FileChangeType.Deleted }
    );
  }

  async createDirectory(uri: vscode.Uri) {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const fullPath = uri.path;
    await this.ipfs.files.mkdir(fullPath);
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri }
    );
  }

  private async _lookup(
    uri: vscode.Uri,
    silent = false
  ): Promise<Entry | undefined> {
    const fullPath = uri.path;
    try {
      const name = path.basename(uri.path);
      const stat = await this.ipfs.files.stat(fullPath);
      return {
        type:
          stat.type === 'directory'
            ? vscode.FileType.Directory
            : vscode.FileType.File,
        ctime: Date.now(),
        mtime: Date.now(),
        size: stat.size,
        name,
      };
    } catch (err) {
      if (err?.code !== 'ERR_NOT_FOUND') throw err;
      if (!silent) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }
  }

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timer;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    return new vscode.Disposable(() => {
      /* noop */
    });
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
