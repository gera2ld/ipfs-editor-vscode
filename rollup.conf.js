const path = require('path');
const {
  defaultOptions,
  getRollupExternal,
  getRollupPlugins,
  loadConfigSync,
} = require('@gera2ld/plaid');
const pkg = require('./package.json');

const DIST = defaultOptions.distDir;
const FILENAME = 'index';
const BANNER = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} License */`;

const external = getRollupExternal([
  'path',
  'vscode',
]);
const bundleOptions = {
  extend: true,
  esModule: false,
};
const postcssConfig = loadConfigSync('postcss') || require('@gera2ld/plaid/config/postcssrc');
const postcssOptions = {
  ...postcssConfig,
  inject: false,
};
const rollupConfig = [
  {
    input: {
      input: 'src/index.ts',
      plugins: getRollupPlugins({
        extensions: defaultOptions.extensions,
        postcss: postcssOptions,
        replaceValues: {
          'process.versions.electron': '""',
        },
        minimize: false,
        aliases: {
          entries: [
            { find: /node_modules\/ipfs-utils\/src\/fetch\.js$/, replacement: 'node_modules/ipfs-utils/src/fetch.browser.js' },
            { find: /node_modules\/ipfs-utils\/src\/http\/fetch\.js$/, replacement: 'node_modules/ipfs-utils/src/http/fetch.node.js' },
          ],
        },
      }),
      external,
    },
    output: {
      format: 'cjs',
      file: `${DIST}/${FILENAME}.node.js`,
    },
  },
  {
    input: {
      input: 'src/index.ts',
      plugins: getRollupPlugins({
        extensions: defaultOptions.extensions,
        postcss: postcssOptions,
        replaceValues: {
          'process.versions.electron': '""',
        },
        minimize: false,
        aliases: {
          entries: [
            { find: /^ipfs-http-client$/, replacement: 'node_modules/ipfs-http-client/dist/index.min.js' },
            { find: path.resolve('src/deps/index.ts'), replacement: path.resolve('src/deps/browser.ts') },
          ],
        },
      }),
      external,
    },
    output: {
      format: 'cjs',
      file: `${DIST}/${FILENAME}.browser.js`,
    },
  },
];

rollupConfig.forEach((item) => {
  item.output = {
    indent: false,
    // If set to false, circular dependencies and live bindings for external imports won't work
    externalLiveBindings: false,
    ...item.output,
    ...BANNER && {
      banner: BANNER,
    },
  };
});

module.exports = rollupConfig.map(({ input, output }) => ({
  ...input,
  output,
}));
