import * as vscode from 'vscode';
import { IPFSProvider } from './fs-provider';

let ipfsProvider: IPFSProvider;

export async function activate(context: vscode.ExtensionContext) {
  const logger = vscode.window.createOutputChannel('IPFS');
  logger.appendLine(`${vscode.Uri.parse('ipfs:/')}`);

  ipfsProvider = IPFSProvider.create(
    {
      url: 'http://127.0.0.1:5001',
    },
    { logger }
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ipfs', ipfsProvider, {
      isCaseSensitive: true,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ipfs.open', async (_) => {
      const ipfsPath = await vscode.window.showInputBox({
        title:
          'Please input an IPFS path (CID or /ipfs/CID or /ipns/hostname):',
        value: '/ipns/gera2ld.crypto',
        validateInput(value) {
          if (!/^(\/ip[fn]s\/)?[^/?]+/.test(value)) return 'Invalid IPFS path';
        },
      });
      if (!ipfsPath) return;
      const rootCid = await ipfsProvider.openFileOrDirectory(ipfsPath);
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders?.length ?? 0,
        {
          uri: vscode.Uri.parse('ipfs:/root'),
          name: `IPFS - ${rootCid}`,
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
