import * as vscode from 'vscode';
import { IPFSProvider } from './fs-provider';

let ipfsProvider: IPFSProvider;

export async function activate(context: vscode.ExtensionContext) {
  const logger = vscode.window.createOutputChannel('IPFS');

  ipfsProvider = new IPFSProvider({ logger });
  const updateEndpoint = () => {
    const endpoint = vscode.workspace
      .getConfiguration('ipfs')
      .get<string>('endpoint');
    ipfsProvider.setEndpoint(endpoint);
  };
  updateEndpoint();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ipfs.endpoint')) updateEndpoint();
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ipfs', ipfsProvider, {
      isCaseSensitive: true,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ipfs.import', async (_) => {
      const ipfsPath = await vscode.window.showInputBox({
        title:
          'Please input an IPFS path (CID or /ipfs/CID or /ipns/hostname):',
        value: '/ipns/gera2ld.crypto',
        validateInput(value) {
          if (!/^(\/ip[fn]s\/)?[^/?]+/.test(value)) return 'Invalid IPFS path';
        },
      });
      if (!ipfsPath) return;
      const dirname = await ipfsProvider.importFileOrDirectory(ipfsPath);
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders?.length ?? 0,
        {
          uri: vscode.Uri.parse(`ipfs:${dirname}`),
          name: `IPFS - ${dirname}`,
        }
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ipfs.open', handleError(async (_) => {
      const dirname = await vscode.window.showInputBox({
        title: 'Please input file path in IPFS:',
        value: '/',
        async validateInput(value) {
          if (!value.startsWith('/')) return 'File path must starts with `/`';
          try {
            const uri = vscode.Uri.parse(`ipfs:${value}`);
            await ipfsProvider.stat(uri);
          } catch (err) {
            logger.appendLine(`${err}`);
            if (err instanceof vscode.FileSystemError.FileNotFound) {
              return 'Path not found in IPFS';
            }
            return `${err}`;
          }
        },
      });
      if (!dirname) return;
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders?.length ?? 0,
        {
          uri: vscode.Uri.parse(`ipfs:${dirname}`),
          name: `IPFS - ${dirname}`,
        }
      );
    }))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ipfs.copyCid', async (uri: vscode.Uri) => {
      const cid = await ipfsProvider.getCid(uri);
      await vscode.env.clipboard.writeText(cid.toString());
      vscode.window.showInformationMessage(`Copied IPFS CID: ${cid}`);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ipfs.copyUrl', async (uri: vscode.Uri) => {
      const cid = await ipfsProvider.getCid(uri);
      const url = `https://dweb.link/ipfs/${cid}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage(`Copied IPFS URL: ${url}`);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ipfs.uploadToWeb3Storage',
      handleError(async (uri: vscode.Uri) => {
        updateConfig();
        await ipfsProvider.uploadToWeb3Storage(uri);
        vscode.window.showInformationMessage(`Uploaded: ${uri.path}`);
      })
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ipfs.publish',
      handleError(async (uri: vscode.Uri) => {
        await publish(uri);
      })
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ipfs.publishUnder',
      handleError(async (uri: vscode.Uri) => {
        await publish(uri, { recursive: true });
      })
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ipfs.uploadAndPublishUnder',
      handleError(async (uri: vscode.Uri) => {
        await publish(uri, { recursive: true, upload: true });
      })
    )
  );

  function updateConfig() {
    const configStr = vscode.workspace
      .getConfiguration('ipfs')
      .get<string>('publishConfig');
    try {
      const config = JSON.parse(configStr);
      ipfsProvider.setConfig(config);
    } catch {
      // noop
    }
  }
  async function publish(
    uri: vscode.Uri,
    opts: { recursive?: boolean; upload?: boolean } = {}
  ) {
    updateConfig();
    const result = await ipfsProvider.publish(uri, opts);
    vscode.window.showInformationMessage(`Published: ${result.join(', ')}`);
  }
}

export async function deactivate() {
  if (ipfsProvider) {
    await ipfsProvider.close();
    ipfsProvider = null;
  }
}

function handleError<T extends unknown[], U>(
  fn: (...args: T) => Promise<U>
): (...args: T) => Promise<U> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      vscode.window.showErrorMessage(`${err}`);
    }
  };
}
