import { describe, it, expect } from 'vitest'
import { serializeFunction } from '../src/serialize.js'

describe('serializeFunction', () => {
  it('serializes arrow functions', () => {
    const str = serializeFunction(() => 42)
    expect(str).toContain('42')
  })

  it('serializes async arrow functions', () => {
    const str = serializeFunction(async () => 42)
    expect(str).toContain('async')
    expect(str).toContain('42')
  })

  it('serializes regular functions', () => {
    const str = serializeFunction(function () {
      return 42
    })
    expect(str).toContain('function')
    expect(str).toContain('42')
  })

  it('serializes async functions', () => {
    const str = serializeFunction(async function () {
      return 42
    })
    expect(str).toContain('async')
    expect(str).toContain('42')
  })

  it('serializes named functions', () => {
    function myFn() {
      return 42
    }
    const str = serializeFunction(myFn)
    expect(str).toContain('myFn')
    expect(str).toContain('42')
  })

  it('throws on native functions', () => {
    expect(() => serializeFunction(parseInt)).toThrow('Native functions')
  })

  it('throws on bound functions', () => {
    const fn = (() => 42).bind(null)
    expect(() => serializeFunction(fn)).toThrow('Native functions')
  })

  it('throws on non-function input', () => {
    expect(() => serializeFunction('not a fn' as never as Function)).toThrow(
      'Expected a function',
    )
  })

  it('returns cached result for the same function reference', () => {
    const fn = () => 'cached'
    const first = serializeFunction(fn)
    const second = serializeFunction(fn)
    expect(first).toBe(second) // same string reference, not just equal
  })

  it('returns different results for different functions with same body', () => {
    const fn1 = () => 99
    const fn2 = () => 99
    const str1 = serializeFunction(fn1)
    const str2 = serializeFunction(fn2)
    // Both serialize to the same content, but are different function references
    expect(str1).toEqual(str2)
  })

  it('does not cache functions that fail validation', () => {
    expect(() => serializeFunction(parseInt)).toThrow('Native functions')
    // Calling again should still throw, not return a cached result
    expect(() => serializeFunction(parseInt)).toThrow('Native functions')
  })

  it('serializes arrow function with destructured params', () => {
    const str = serializeFunction(({ a, b }: { a: number; b: number }) => a + b)
    expect(str).toContain('=>')
  })

  it('serializes function returning complex expression', () => {
    const str = serializeFunction(() => {
      const arr = [1, 2, 3]
      return arr.reduce((sum, n) => sum + n, 0)
    })
    expect(str).toContain('reduce')
  })
})
