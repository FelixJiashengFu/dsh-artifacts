// Build both halves of the plugin with esbuild.
//
// lib/index.js  — Host half (Node ESM). Every @deepseek-ai/* import stays
//                 external so the running harness supplies shared instances.
// lib/client.js — Browser half in DSH's client-module format: a factory
//                 registered through window.__ModuleLoader__.load({ id, factory }),
//                 whose `require` resolves the shell's shared module table.
import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lib = join(root, 'lib')

// Modules the DSH web shell shares with every client plugin (platform seed table).
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

await rm(lib, { recursive: true, force: true })
await mkdir(lib, { recursive: true })

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(lib, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'warning',
})

const client = await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
})

// Any other @deepseek-ai import reaching the bundle is a value import of a
// plugin package, which client bundles must not contain.
for (const input of Object.values(client.metafile.inputs)) {
  for (const imp of input.imports) {
    if (imp.external && !imp.path.startsWith("<") && !PLATFORM_MODULES.includes(imp.path)) {
      throw new Error(`client bundle requests non-platform module "${imp.path}"; import it as a type only`)
    }
  }
}

const body = client.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
await writeFile(join(lib, 'client.js'), wrapped)
console.log(`built lib/index.js and lib/client.js (${(wrapped.length / 1024).toFixed(1)} KiB)`)
