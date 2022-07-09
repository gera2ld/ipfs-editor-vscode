import * as path from 'path';
import { create } from 'ipfs-http-client';

const ipfs = create({
  url: 'http://127.0.0.1:5001',
});
const root = '/root';
for await (const item of ipfs.files.ls(root)) {
  console.log(item);
}
console.log('done');
console.log(await ipfs.files.stat(root));
