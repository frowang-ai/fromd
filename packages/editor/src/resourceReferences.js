const legacy = /^\.frowd-assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/
const urlSegment = /^(?:[A-Za-z0-9._~-]|%[0-9a-f]{2})+$/i

export function isPersistentResource(reference) {
  if (typeof reference !== 'string' || reference.length > 4096) return false
  return legacy.test(reference) || isDocumentAssetReference(reference)
}

export function isDocumentAssetReference(reference) {
  if (typeof reference !== 'string' || reference.length > 4096) return false
  const parts = reference.split('/')
  if (parts.length !== 2 || !parts[0].endsWith('.assets') || parts[0] === '.assets') return false
  try {
    return parts.every(part => {
      if (!urlSegment.test(part)) return false
      const name = decodeURIComponent(part)
      return name !== '.' && name !== '..' && !/[/\\:\x00-\x1f\x7f]/.test(name)
    })
  } catch {
    return false
  }
}
