import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from './src/server/app'

const ROOT = process.cwd()
const server = createServer({ root: ROOT })
await server.fastify.ready()
const base = await server.listen(0)
const port = Number(new URL(base).port)

const dir = 'cache/test-fixtures/plate-27166d4c5f3f2545'
const fixture = JSON.parse(readFileSync(path.join(ROOT, dir, 'fixture.json'), 'utf8')) as {
  res: [number, number]
  files: Record<string, { url: string; channels: number; dtype: string }>
}
const uploaded = await fetch(`${base}/upload?ext=webm`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream' },
  body: new Uint8Array(readFileSync(path.join(ROOT, 'cache/test-export/clip.webm'))),
})
const asset = ((await uploaded.json()) as { asset: string }).asset

const spec = {
  id: 'diag',
  manifest: {
    res: fixture.res,
    files: Object.fromEntries(
      Object.entries(fixture.files).map(([k, v]) => [
        k,
        { ...v, url: `${base}/${dir}/${path.basename(v.url)}` },
      ]),
    ),
  },
  videoUrl: `${base}/${asset}`,
  fps: 30,
  frames: 3,
}
void server.context.exports
  .start(spec as never, 'cache/test-export/diag.mov', undefined, 25_000)
  .catch(() => undefined)
await new Promise((r) => setTimeout(r, 400))

const url = `http://127.0.0.1:${port}/app/export.html?job=diag`
console.log('job route ->', (await fetch(`http://127.0.0.1:${port}/export-job/diag`)).status)
const dom = execFileSync(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'diag-'))}`,
    '--use-angle=metal',
    '--no-first-run',
    '--virtual-time-budget=20000',
    '--dump-dom',
    url,
  ],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
)
console.log('TITLE:', /<title>([^<]*)<\/title>/.exec(dom)?.[1])
await server.close()
process.exit(0)
