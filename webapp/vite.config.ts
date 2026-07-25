import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Tiny persistence API: GET/PUT /api/graph <-> webapp/graph.json
// Makes the file the source of truth so edits survive reloads and are shared
// across machines that hit this dev server.
function graphApi(): Plugin {
  return {
    name: 'graph-api',
    configureServer(server) {
      const file = resolve(server.config.root, 'graph.json')
      server.middlewares.use('/api/graph', (req, res) => {
        if (req.method === 'GET') {
          readFile(file, 'utf8')
            .then((data) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            })
            .catch(() => {
              res.statusCode = 204 // no file yet
              res.end()
            })
          return
        }
        if (req.method === 'PUT') {
          const chunks: Buffer[] = []
          req.on('data', (c) => chunks.push(c as Buffer))
          req.on('end', () => {
            writeFile(file, Buffer.concat(chunks).toString('utf8'))
              .then(() => {
                res.statusCode = 200
                res.end('{"ok":true}')
              })
              .catch(() => {
                res.statusCode = 500
                res.end('{"ok":false}')
              })
          })
          return
        }
        res.statusCode = 405
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), graphApi()],
  server: { host: true, port: 5173 },
})
