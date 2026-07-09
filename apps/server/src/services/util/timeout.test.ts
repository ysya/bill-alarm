import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from './timeout.js'

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('resolves with the value when the promise settles before the timeout', async () => {
    const promise = withTimeout(Promise.resolve('done'), 1000, '操作')
    await expect(promise).resolves.toBe('done')
  })

  it('rejects with the labeled message when the promise never settles', async () => {
    const never = new Promise(() => {})
    const promise = withTimeout(never, 1000, '測試操作')
    const assertion = expect(promise).rejects.toThrow('測試操作 超時（1秒）')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('propagates the original rejection reason when the wrapped promise rejects first', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 1000, '操作')
    await expect(promise).rejects.toThrow('boom')
  })

  it('clears the timer once the promise resolves (no dangling timer)', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000, '操作')
    await promise
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer once the promise rejects (no dangling timer)', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 1000, '操作')
    await promise.catch(() => {})
    expect(vi.getTimerCount()).toBe(0)
  })
})
