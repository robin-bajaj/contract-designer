import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./main.jsx', import.meta.url)), 'utf8')

test('React entrypoint resolves the React identifier used by classic JSX transform', () => {
  assert.match(source, /import\s+React\s+from\s+['"]react['"]/)
  assert.match(source, /createRoot\(root\)\.render\(<App\s*\/>\)/)
})
