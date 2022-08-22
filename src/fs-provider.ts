import { IPFSHTTPClient, create } from 'ipfs-http-client';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Entry extends vscode.FileStat {
  name: string;
}

function noop<T>(): T | undefined {
  return;
}

export class IPFSProvider implements vscode.FileSystemProvider {
  private logger?: vscode.OutputChannel;

  ipfs: IPFSHTTPClient;

  constructor(providerOpts?: {
    endpoint?: string;
    logger?: vscode.OutputChannel;
  }) {
    this.logger = providerOpts?.logger;
    this.setEndpoint(providerOpts?.endpoint);
  }

  setEndpoint(url: string) {
    this.ipfs = url && create({ url });
  }

  async close() {
    this.ipfs = null;
  }

  async importFileOrDirectory(ipfsPath?: string) {
    if (ipfsPath) ipfsPath = await this.ipfs.resolve(ipfsPath);
    if (!ipfsPath) return;
    this.logger.appendLine('ipfsPath: ' + ipfsPath);
    const stat = await this.ipfs.files.stat(ipfsPath);
    if (!stat) return;
    const dateStr = new Date().toISOString().split('T')[0];
    let idx = 0;
    const prefix = '/vscode-imports/';
    let dirname = prefix + dateStr;
    while (await this.ipfs.files.stat(dirname).catch(noop)) {
      idx += 1;
      dirname = `${prefix}${dateStr}_${idx}`;
    }
    if (stat.type === 'directory') {
      this.logger.appendLine('directory');
      await this.ipfs.files.cp(ipfsPath, dirname, { cidVersion: 1 });
    } else {
      this.logger.appendLine('file');
      await this.ipfs.files.mkdir(dirname, { parents: true, cidVersion: 1 });
      await this.ipfs.files.cp(ipfsPath, `${dirname}/file`, { cidVersion: 1 });
    }
    return dirname;
  }

  async stat(uri: vscode.Uri) {
    this.logger.appendLine('stat ' + uri);
    const filePath = uri.path;
    try {
      const stat = await this.ipfs.files.stat(filePath);
      return {
        type:
          stat.type === 'directory'
            ? vscode.FileType.Directory
            : vscode.FileType.File,
        ctime: Date.now(),
        mtime: Date.now(),
        size: stat.size,
        name: path.basename(filePath),
      };
    } catch (err) {
      if (err?.code === 'ERR_NOT_FOUND') {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw err;
    }
  }

  async getCid(uri: vscode.Uri) {
    const stat = await this.ipfs.files.stat(uri.path);
    return stat.cid.toString();
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
    this.logger.appendLine('readFile ' + fullPath);
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
    const entry = await this.stat(uri).catch<Entry>(noop);
    if (entry?.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    if (!options.overwrite && entry) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    try {
      await this.ipfs.files.write(fullPath, content, {
        create: options.create,
        cidVersion: 1,
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
    if (!options.overwrite && (await this.stat(newUri).catch<Entry>(noop))) {
      throw vscode.FileSystemError.FileExists(newUri);
    }
    const oldPath = oldUri.path;
    const newPath = newUri.path;
    await this.ipfs.files.mv(oldPath, newPath, { cidVersion: 1 });

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
    await this.ipfs.files.mkdir(fullPath, { cidVersion: 1 });
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri }
    );
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
