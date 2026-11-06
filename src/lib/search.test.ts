import assert from 'node:assert/strict'
import test from 'node:test'
import { filterByQuery, matchesQuery } from './search.ts'

const akshay = { name: 'Akshay', email: 'akshay@cheetahs.example' }

test('partial name match ignores case', () => {
  assert.equal(matchesQuery('sha', [akshay.name, akshay.email]), true)
  assert.equal(matchesQuery('SHA', [akshay.name, akshay.email]), true)
  assert.equal(matchesQuery('  Ak  ', [akshay.name]), true)
})

test('email substring matches and a miss stays hidden', () => {
  assert.equal(matchesQuery('cheetahs.example', [akshay.name, akshay.email]), true)
  assert.equal(matchesQuery('zzz', [akshay.name, akshay.email]), false)
  assert.equal(matchesQuery('', [akshay.name]), true)
  assert.equal(matchesQuery('   ', [akshay.name]), true)
})

test('filter keeps the original order', () => {
  const rows = [
    { name: 'Ben', email: 'ben@club.test' },
    akshay,
    { name: 'Shaan', email: 'shaan@club.test' },
  ]
  const found = filterByQuery(rows, 'sha', (row) => [row.name, row.email])
  assert.deepEqual(
    found.map((row) => row.name),
    ['Akshay', 'Shaan'],
  )
})
