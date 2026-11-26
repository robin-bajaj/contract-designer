import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./App.jsx', import.meta.url)), 'utf8')

test('sidebar Search component is explicitly imported to avoid a blank screen', () => {
  assert.match(source, /<Search\s/)
  assert.match(source, /import\s*\{[^}]*\bSearch\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
})
