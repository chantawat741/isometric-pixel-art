// Tiny static server so the panel can be previewed in a normal browser during development.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../panel')
const port = Number(process.env.PORT ?? 5173)

createServer((req, res) => {
  const file = resolve(root, 'index.html')
  if ((req.url ?? '/').split('?')[0] !== '/' || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}).listen(port, () => console.log(`Pixel Base preview on http://localhost:${port}`))
