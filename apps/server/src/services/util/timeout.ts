/**
 * Race a promise against a timeout, rejecting with a labeled error if it hasn't
 * settled in time. Does not cancel the underlying operation — it keeps running in
 * the background and its eventual result/rejection is simply ignored once this
 * wrapper has already settled via the timeout branch.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超時（${ms / 1000}秒）`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
