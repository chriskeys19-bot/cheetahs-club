import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PRIVACY_PARAGRAPHS, TERMS_PARAGRAPHS } from './legalCopy.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function page(name: string): string {
  return readFileSync(join(root, 'public', name), 'utf8')
}

test('public privacy and terms pages state the YouTube use in plain text', () => {
  const privacy = page('privacy.html')
  const terms = page('terms.html')
  for (const file of [privacy, terms]) {
    assert.match(file, /CricketCrazeUSA/)
    assert.match(file, /cricketcrazeusa@gmail\.com/)
    assert.match(file, /https:\/\/myaccount\.google\.com\/permissions/)
    assert.match(file, /does not sell/)
    assert.match(file, /server/)
    assert.match(file, /live broadcast list/)
    assert.match(file, /https:\/\/cheetahs-club\.pages\.dev\/privacy/)
    assert.match(file, /https:\/\/cheetahs-club\.pages\.dev\/terms/)
    assert.doesNotMatch(file, /noindex/)
  }
  assert.match(privacy, /start and end live broadcasts/)
  assert.match(terms, /start and end live broadcasts/)
  assert.match(PRIVACY_PARAGRAPHS.join('\n'), /does not sell personal data/)
  assert.match(TERMS_PARAGRAPHS.join('\n'), /stored on the club/)
})
