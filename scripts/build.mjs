// Bundles src/main.ts and inlines it into panel/index.html (single file, no network needed
// inside Orca's sandboxed panel frame).
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const template = resolve(root, 'src/index.template.html')
const out = resolve(root, 'panel/index.html')

async function run() {
  const result = await build({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent'
  })
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const html = readFileSync(template, 'utf8').replace('<!--BUNDLE-->', () => `<script>${js}</script>`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  console.log(`[build] panel/index.html  ${(html.length / 1024).toFixed(1)} KB  ${new Date().toLocaleTimeString()}`)
}

async function safeRun() {
  try {
    await run()
  } catch (error) {
    console.error('[build] failed:', error.message ?? error)
    if (!process.argv.includes('--watch')) process.exitCode = 1
  }
}

await safeRun()

if (process.argv.includes('--watch')) {
  let timer
  watch(resolve(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(safeRun, 120)
  })
  console.log('[build] watching src/ ...')
}
