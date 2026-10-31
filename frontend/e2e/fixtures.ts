import { test as base } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export { expect, type Page, type Locator, type BrowserContext } from '@playwright/test'

/** Every journey owns a backend and database; tests cannot fill each other's calendars. */
export const test = base.extend<{ isolatedBackend: void }>({
  isolatedBackend: [
    async ({}, use, testInfo) => {
      const probe = createServer()
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject)
        probe.listen(8766, '127.0.0.1', () => probe.close(() => resolve()))
      })
      const child = spawn(
        'bash',
        [fileURLToPath(new URL('../../scripts/test-server.sh', import.meta.url))],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: process.env,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let logs = ''
      const record = (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-20000)
      }
      child.stdout.on('data', record)
      child.stderr.on('data', record)
      child.on('error', (error) => {
        logs += String(error)
      })
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      const signal = (name: NodeJS.Signals) => {
        if (child.exitCode !== null || !child.pid) return
        try {
          if (process.platform === 'win32') child.kill(name)
          else process.kill(-child.pid, name)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
      try {
        let ready = false
        for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
          try {
            const response = await fetch('http://127.0.0.1:8766/api/v1/health', {
              signal: AbortSignal.timeout(500),
            })
            if (response.ok) {
              ready = true
              break
            }
          } catch {}
          await delay(100)
        }
        if (!ready) throw new Error('Isolated backend did not start:\n' + logs)
        await use()
      } finally {
        signal('SIGTERM')
        const timer = setTimeout(() => signal('SIGKILL'), 10000)
        timer.unref()
        try {
          await stopped
        } finally {
          clearTimeout(timer)
        }
        if (testInfo.status !== testInfo.expectedStatus)
          await testInfo.attach('backend.log', {
            body: Buffer.from(logs),
            contentType: 'text/plain',
          })
      }
    },
    { auto: true },
  ],
})
