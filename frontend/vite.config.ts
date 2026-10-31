import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Retain license text for packages actually included in the compiled frontend. */
function dependencyNotices(moduleIds: Iterable<string>) {
  const packages = new Map<string, string>()
  const visited = new Set<string>()
  for (const id of moduleIds) {
    if (!id.includes('node_modules') || id.startsWith('\0')) continue
    let directory = dirname(id.split('?')[0])
    while (directory !== dirname(directory) && !visited.has(directory)) {
      visited.add(directory)
      const metadata = join(directory, 'package.json')
      if (existsSync(metadata)) {
        const pkg = JSON.parse(readFileSync(metadata, 'utf8'))
        if (pkg.name && pkg.version) {
          const files = readdirSync(directory).filter(
            (name) =>
              /^(licen[sc]e|copying|notice)([._-]|$)/i.test(name) &&
              statSync(join(directory, name)).isFile(),
          )
          const notices = files.map(
            (name) => `${name}\n${readFileSync(join(directory, name), 'utf8')}`,
          )
          packages.set(
            `${pkg.name}@${pkg.version}`,
            `License: ${JSON.stringify(pkg.license || 'See package distribution')}\n\n${notices.join('\n\n')}`,
          )
          break
        }
      }
      directory = dirname(directory)
    }
  }
  return [...packages.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, text]) => `${name}\n${'='.repeat(name.length)}\n${text}`)
    .join('\n\n')
}

const guide = new URL('../docs/HUONG_DAN_SU_DUNG.md', import.meta.url)
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const env = { ...loadEnv(mode, root, 'PDM_'), ...process.env }
  const backendPort = Number(env.PDM_PORT || 8765)
  const devPort = Number(env.PDM_DEV_PORT || 5173)
  for (const port of [backendPort, devPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('PDM ports must be integers between 1 and 65535')
  }
  return {
    plugins: [
      react(),
      {
        name: 'user-guide',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'licenses/dependencies.txt',
            source: dependencyNotices(this.getModuleIds()),
          })
          this.emitFile({
            type: 'asset',
            fileName: 'huong-dan-su-dung.md',
            source: readFileSync(guide, 'utf8'),
          })
          this.emitFile({
            type: 'asset',
            fileName: 'licenses/pdfjs-LICENSE',
            source: readFileSync(new URL('./node_modules/pdfjs-dist/LICENSE', import.meta.url)),
          })
          this.emitFile({
            type: 'asset',
            fileName: 'licenses/THIRD_PARTY_NOTICES.md',
            source: readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)),
          })
          this.emitFile({
            type: 'asset',
            fileName: 'licenses/MIT.txt',
            source: readFileSync(new URL('../LICENSE', import.meta.url)),
          })
          for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
            const root = new URL('./node_modules/pdfjs-dist/' + directory + '/', import.meta.url)
            for (const file of readdirSync(root))
              this.emitFile({
                type: 'asset',
                fileName: 'pdf-assets/' + directory + '/' + file,
                source: readFileSync(new URL(file, root)),
              })
          }
        },
        configureServer(server) {
          server.middlewares.use('/pdf-assets/', (request, response, next) => {
            const match = request.url?.match(/^\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/)
            if (!match) return next()
            try {
              response.end(
                readFileSync(
                  new URL(
                    './node_modules/pdfjs-dist/' + match[1] + '/' + match[2],
                    import.meta.url,
                  ),
                ),
              )
            } catch {
              next()
            }
          })
          server.middlewares.use('/huong-dan-su-dung.md', (_request, response) => {
            response.setHeader('Content-Type', 'text/markdown; charset=utf-8')
            response.end(readFileSync(guide, 'utf8'))
          })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: devPort,
      strictPort: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      proxy: {
        '/api': `http://127.0.0.1:${backendPort}`,
        '/office-runtime': `http://127.0.0.1:${backendPort}`,
      },
    },
    build: {
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
          docx: fileURLToPath(new URL('./docx-editor.html', import.meta.url)),
        },
        output: {
          manualChunks(id) {
            if (
              id.includes('@fullcalendar') ||
              id.includes('@full-ui') ||
              id.includes('temporal-polyfill')
            )
              return 'calendar'
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          },
        },
      },
    },
  }
})
