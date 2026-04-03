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
})
