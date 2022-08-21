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
    vscode.commands.registerCommand('ipfs.open', async (_) => {
      const dirname = await vscode.window.showInputBox({
        title: 'Please input file path in IPFS:',
        value: '/',
        async validateInput(value) {
          if (!value.startsWith('/')) return 'File path must starts with `/`';
          try {
            const uri = vscode.Uri.parse(`ipfs:${value}`);
            await ipfsProvider.stat(uri);
          } catch (err) {
            if (err instanceof vscode.FileSystemError.FileNotFound) {
              return 'Path not found in IPFS';
            }
            return `${err}`;
          }
        },
      });
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
}

export async function deactivate() {
  if (ipfsProvider) {
    await ipfsProvider.close();
    ipfsProvider = null;
  }
}
