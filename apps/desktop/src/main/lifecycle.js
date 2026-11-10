import { resolve } from 'node:path'
export function openFileArguments(argv, workingDirectory = process.cwd()) {
  return argv.filter(arg => typeof arg === 'string' && !arg.startsWith('-') && /\.(md|markdown|txt)$/i.test(arg)).map(path => resolve(workingDirectory, path))
}
// Initialization is the first operation. IPC/second-instance requests cannot
// write recovery state until the original session has been read completely.
export function operationQueue(initialization) {
  let tail = Promise.resolve(initialization)
  return fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next }
}
