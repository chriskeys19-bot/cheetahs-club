import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVideoUrl } from './games.ts'

test('accepts http and https YouTube links and trims them', () => {
  assert.equal(
    parseVideoUrl('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  '),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  )
  assert.equal(parseVideoUrl('http://youtu.be/dQw4w9WgXcQ'), 'http://youtu.be/dQw4w9WgXcQ')
  assert.equal(
    parseVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  )
  assert.equal(
    parseVideoUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  )
  assert.equal(
    parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  )
  assert.equal(parseVideoUrl('https://www.youtu.be/dQw4w9WgXcQ?t=12'), 'https://www.youtu.be/dQw4w9WgXcQ?t=12')
})

test('blank input clears the link', () => {
  assert.equal(parseVideoUrl(''), null)
  assert.equal(parseVideoUrl('   '), null)
})

test('rejects hosts that are not YouTube and unsafe URLs', () => {
  assert.equal(parseVideoUrl('https://vimeo.com/123456789'), 'invalid')
  assert.equal(parseVideoUrl('https://cricclubs.com/NCCA/results/abc'), 'invalid')
  assert.equal(parseVideoUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), 'invalid')
  assert.equal(parseVideoUrl('https://evil.com/?next=https://youtu.be/dQw4w9WgXcQ'), 'invalid')
  assert.equal(parseVideoUrl('javascript:alert(1)'), 'invalid')
  assert.equal(parseVideoUrl('ftp://youtube.com/watch?v=dQw4w9WgXcQ'), 'invalid')
  assert.equal(parseVideoUrl('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ'), 'invalid')
  assert.equal(parseVideoUrl('https://www.youtube.com:443/watch?v=dQw4w9WgXcQ'), 'invalid')
  assert.equal(parseVideoUrl('https://www.youtube.com/'), 'invalid')
  assert.equal(parseVideoUrl('https://youtu.be'), 'invalid')
  assert.equal(parseVideoUrl(`https://youtu.be/${'a'.repeat(500)}`), 'invalid')
})
