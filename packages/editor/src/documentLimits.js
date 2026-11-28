export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
export const utf8Bytes = text => new TextEncoder().encode(text).byteLength
