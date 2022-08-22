# IPFS Editor for VSCode

![vscode](https://img.shields.io/visual-studio-marketplace/v/gera2ld.ipfs-editor-vscode)
![open vsx](https://img.shields.io/open-vsx/v/gera2ld/ipfs-editor-vscode)

The is a VSCode extension to load and edit files on IPFS.

<img width="739" alt="IPFS Editor" src="https://user-images.githubusercontent.com/3139113/185931465-cc27701d-c386-4919-b621-c9a722b1f3ca.png">

## Features

- [x] Import file/directory by CID
- [x] Import file/directory by IPNS
- [x] Edit/save file
- [x] Upload new CAR to web3.storage
- [x] Publish with DNSLink

## Settings

Open Settings and filter by `IPFS`, you'll see the settings below.

### Endpoint

The API address to your IPFS node, `http://127.0.0.1:5001` by default.

Note that you need to start your local IPFS daemon before you can connect to its endpoint.

### Publish Config

The configuration for publishing nodes.

```json
{
  "web3StorageToken": "...",
  "dnsConfig": {
    "cloudflare": {
      "token": "..."
    }
  },
  "domainProvider": {
    "mydomain.com": "cloudflare"
  }
}
```

- Get your own [web3.storage](https://web3.storage) token.
- Only `cloudflare` is supported at the moment, set your token here to support DNSLink.
- `domainProvider` is a mapping between your top-level domain and its provider. Only `cloudflare` is supported at the moment.

## Usage

- Open command palette and search `IPFS`
- Edit files like in local file system
- Upload and publish new changes with a click

### How to add a domain?

- Link a directory to a domain:
  - Create a file named `CNAME` with the desired domain as its content.
  - Put it in the directory which is supposed to be linked to this domain.

  Example:

  ```
  .
  └── blog/
      ├── CNAME                    # content: awesome.com
      ├── index.html
      └── another-file
  ```

  When publishing `blog`, its CID will be linked to `awesome.com` if its provider is properly configured.

- Link a file to a domain:
  - Create a file with a name of the target file suffixed with `.CNAME`, and fill its content with the desired domain.
  - Put the file in the same directory as the target file.

  Example:

  ```
  .
  └── anywhere/
      ├── target.html
      └── target.html.CNAME        # content: awesome.com
  ```
