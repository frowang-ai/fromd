import { Worker } from 'node:worker_threads'

// The build emits this entry next to index.js; Electron's Worker supports asar paths.
export class RecoveryDatabase {
  constructor(directory, maxSessionBytes) {
    this.pending = new Map(); this.sequence = 0; this.failure = null
    this.worker = new Worker(new URL('./storageWorker.js', import.meta.url), { workerData: { directory, maxSessionBytes } })
    this.worker.on('message', ({ id, result, error }) => {
      const request = this.pending.get(id)
      if (!request) return
      this.pending.delete(id)
      if (error) request.reject(new Error(error)); else request.resolve(result)
      if (!this.pending.size) this.worker.unref()
    })
    const fail = error => {
      this.failure = error
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear(); this.worker.unref()
    }
    this.worker.on('error', fail)
    this.worker.on('exit', code => fail(new Error(`草稿存储进程已退出 (${code})。`)))
    this.worker.unref()
  }
  request(operation, payload) {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      this.pending.set(id, { resolve, reject }); this.worker.ref()
      this.worker.postMessage({ id, operation, payload })
    })
  }
  async dispose() {
    if (!this.failure) await this.request('close').catch(() => {})
    await this.worker.terminate()
  }
}
