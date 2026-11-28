export function isResourceProtocol(url) {
  return url.protocol === 'frowd-resource:' ||
    (['http:', 'https:'].includes(url.protocol) && url.hostname.replace(/\.$/, '') === 'frowd-resource.localhost')
}

export function remoteImageUrl(source) {
  const value = source?.trim()
  if (!/^(?:https?:)?\/\/[^/\\]/i.test(value)) return null
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value)
    return !isResourceProtocol(url) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
