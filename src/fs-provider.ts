import { IPFSHTTPClient, create } from 'ipfs-http-client';
import type { StatResult } from 'ipfs-core-types/files';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { fetch, getDomain } from './deps';
import { updateDNSLink as updateDNSLinkCloudflare } from './dnslink/cloudflare';

const dnsLinkProviders: Record<
  string,
  (hostname: string, ipfsPath: string, config: unknown) => Promise<void>
> = {
  cloudflare: updateDNSLinkCloudflare,
};

export interface Entry extends vscode.FileStat {
  name: string;
  ipfsStat: StatResult;
}

export interface IPFSProviderConfig {
  web3StorageToken?: string;
  dnsConfig?: Record<string, unknown>;
  domainProvider?: Record<string, string>;
}

function noop<T>(): T | undefined {
  return;
}

export class IPFSProvider implements vscode.FileSystemProvider {
  private logger?: vscode.OutputChannel;

  ipfs: IPFSHTTPClient;

  private config: IPFSProviderConfig;

  constructor(providerOpts?: {
    endpoint?: string;
    logger?: vscode.OutputChannel;
    config?: IPFSProviderConfig;
  }) {
    this.logger = providerOpts?.logger;
    this.setEndpoint(providerOpts?.endpoint);
    this.setConfig(providerOpts?.config || {});
  }

  setEndpoint(url: string) {
    this.log(`Endpoint: ${url}`);
    this.ipfs = url && create({ url });
  }

  setConfig(config: IPFSProviderConfig) {
    this.config = config;
  }

  private log(line: string) {
    this.logger?.appendLine(line);
  }

  async close() {
    this.ipfs = null;
  }

  isNotFoundError(err: any) {
    return err?.code === 'ERR_NOT_FOUND' || err?.message === 'file does not exist';
  }

  async importFileOrDirectory(ipfsPath?: string) {
    if (ipfsPath) ipfsPath = await this.ipfs.resolve(ipfsPath);
    if (!ipfsPath) return;
    this.log('Import ipfsPath: ' + ipfsPath);
    const stat = await this.ipfs.files.stat(ipfsPath);
    if (!stat) return;
    const dateStr = new Date().toISOString().split('T')[0];
    let idx = 0;
    const prefix = '/vscode-imports/';
    let dest = prefix + dateStr;
    while (await this.ipfs.files.stat(dest).catch(noop)) {
      idx += 1;
      dest = `${prefix}${dateStr}_${idx}`;
    }
    if (stat.type === 'directory') {
      this.log('Found directory');
      await this.ipfs.files.mkdir(prefix, { parents: true, cidVersion: 1 });
      await this.ipfs.files.cp(ipfsPath, dest, { cidVersion: 1 });
    } else {
      this.log('Found file');
      await this.ipfs.files.mkdir(dest, { parents: true, cidVersion: 1 });
      await this.ipfs.files.cp(ipfsPath, `${dest}/file`, { cidVersion: 1 });
    }
    return dest;
  }

  private async internalStat(uri: vscode.Uri) {
    this.log('stat ' + uri);
    const filePath = uri.path;
    try {
      const stat = await this.ipfs.files.stat(filePath);
      this.log('stat result: ' + JSON.stringify(stat));
      return {
        type:
          stat.type === 'directory'
            ? vscode.FileType.Directory
            : vscode.FileType.File,
        ctime: Date.now(),
        mtime: Date.now(),
        size: stat.size,
        name: Utils.basename(uri),
        ipfsStat: stat,
      };
    } catch (err) {
      this.log(`Error ${err.name}/${err.code}/${err.message}`);
      if (this.isNotFoundError(err)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw err;
    }
  }

  stat(uri: vscode.Uri) {
    return this.internalStat(uri);
  }

  async getCid(uri: vscode.Uri) {
    const stat = await this.ipfs.files.stat(uri.path);
    return stat.cid;
  }

  async readDirectory(uri: vscode.Uri) {
    this.log('readDir ' + uri);
    const fullPath = uri.path;
    const items = await arrayFromAsync(this.ipfs.files.ls(fullPath));
    return items.map((item) => [
      item.name,
      item.type === 'directory'
        ? vscode.FileType.Directory
        : vscode.FileType.File,
    ]) as Array<[name: string, type: vscode.FileType]>;
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
    this.log('readFile ' + fullPath);
    try {
      const buffer = await arrayFromAsync(this.ipfs.files.read(fullPath));
      return this.mergeUint8Array(buffer);
    } catch (err) {
      if (this.isNotFoundError(err)) {
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
    const entry = await this.internalStat(uri).catch<Entry>(noop);
    if (entry?.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    if (!options.overwrite && entry) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    this.log('writeFile ' + fullPath);
    try {
      await this.ipfs.files.write(fullPath, content, {
        cidVersion: 1,
        create: options.create,
        truncate: true,
      });
    } catch (err) {
      if (this.isNotFoundError(err)) {
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
    const dirname = Utils.dirname(uri);
    const fullPath = uri.path;
    await this.ipfs.files.rm(fullPath, { recursive: true });
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { uri, type: vscode.FileChangeType.Deleted }
    );
  }

  async createDirectory(uri: vscode.Uri) {
    const dirname = Utils.dirname(uri);
    const fullPath = uri.path;
    await this.ipfs.files.mkdir(fullPath, { cidVersion: 1 });
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri }
    );
  }

  async exportCar(uri: vscode.Uri) {
    const cid = await this.getCid(uri);
    const chunks = await arrayFromAsync(this.ipfs.dag.export(cid));
    return this.mergeUint8Array(chunks);
  }

  async uploadToWeb3Storage(uri: vscode.Uri) {
    const token = this.config.web3StorageToken;
    if (!token) throw new Error('Web3Storage token is required!');
    this.log('Uploading ' + uri);
    const name = Utils.basename(uri);
    const car = await this.exportCar(uri);
    const res = await fetch('https://api.web3.storage/car', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-name': name,
      },
      body: car,
    });
    const data = await res.json();
    if (!res.ok) throw { status: res.status, data };
    this.log('Uploaded ' + uri);
    return data;
  }

  async findCnames(uri: vscode.Uri, recursive = false) {
    const results: Record<string, string> = {};

    const addCname = async (cid: string, cnamePath: string) => {
      const chunks = await arrayFromAsync(this.ipfs.files.read(cnamePath));
      const bin = this.mergeUint8Array(chunks);
      const text = new TextDecoder().decode(bin);
      const domains = text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      domains.forEach((domain) => {
        results[domain] = cid;
      });
    };

    const checkFile = async (path: string) => {
      const statRes = await this.ipfs.files.stat(path);

      // handle file
      if (statRes.type === 'file') {
        try {
          await this.ipfs.files.stat(`${path}.CNAME`);
          await addCname(statRes.cid.toString(), `${path}.CNAME`);
        } catch {
          // noop
        }
        return;
      }

      // handle directory
      const items = await arrayFromAsync(this.ipfs.files.ls(path));
      const files = items.filter((item) => item.type === 'file');
      if (files.find((item) => item.name === 'CNAME')) {
        await addCname(statRes.cid.toString(), `${path}/CNAME`);
      }

      if (!recursive) return;

      // files inside directory
      const cnames = files.filter((item) => item.name.endsWith('.CNAME'));
      for (const cname of cnames) {
        const filename = cname.name.slice(0, -6);
        const file = files.find((item) => item.name === filename);
        if (file) await addCname(file.cid.toString(), `${path}/${cname.name}`);
      }

      // nested directories
      const dirs = items.filter((item) => item.type === 'directory');
      for (const dir of dirs) {
        await checkFile(`${path}/${dir.name}`);
      }
    };

    await checkFile(uri.path);
    return results;
  }

  async publish(
    uri: vscode.Uri,
    opts: { recursive?: boolean; upload?: boolean } = {}
  ) {
    if (opts.upload) {
      await this.uploadToWeb3Storage(uri);
    }
    const cnames = await this.findCnames(uri, opts.recursive);
    this.log('Found cnames: ' + JSON.stringify(cnames, null, 2));
    const result: string[] = [];
    for (const [cname, cid] of Object.entries(cnames)) {
      const domain: string = getDomain(cname);
      const provider = this.config.domainProvider?.[domain];
      const config = this.config.dnsConfig?.[provider];
      const update = dnsLinkProviders[provider];
      if (config && update) {
        this.log('Update DNS: ' + cname);
        await update(cname, `/ipfs/${cid}`, config);
        result.push(cname);
      }
    }
    return result;
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

async function arrayFromAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
