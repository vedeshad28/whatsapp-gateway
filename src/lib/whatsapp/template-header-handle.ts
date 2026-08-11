import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE, VIDEO, or DOCUMENT
 * header — a plain public URL is not accepted at creation time. This
 * helper turns the template's `header_media_url` (whether the user
 * uploaded a file or pasted a link) into a handle and writes it onto
 * the payload, so both the upload path and the legacy URL path
 * actually succeed.
 *
 * No-op unless the header is image/video/document, has a URL, and has
 * no handle yet.
 */

type MediaHeaderType = 'image' | 'video' | 'document'

interface MediaLimits {
  maxBytes: number
  allowedTypes: string[]
  fileName: string
}

// Meta's header sample limits per media type.
const MEDIA_LIMITS: Record<MediaHeaderType, MediaLimits> = {
  image: { maxBytes: 5 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png'], fileName: 'header.jpg' },
  video: { maxBytes: 16 * 1024 * 1024, allowedTypes: ['video/mp4', 'video/3gpp'], fileName: 'header.mp4' },
  document: { maxBytes: 100 * 1024 * 1024, allowedTypes: ['application/pdf'], fileName: 'header.pdf' },
}

function isMediaHeaderType(value: TemplatePayload['header_type']): value is MediaHeaderType {
  return value === 'image' || value === 'video' || value === 'document'
}

function describeAllowedTypes(allowed: string[]): string {
  return allowed.map((t) => t.split('/')[1]?.toUpperCase() ?? t).join(' or ')
}

export async function ensureImageHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
): Promise<void> {
  const headerType = payload.header_type
  if (!isMediaHeaderType(headerType)) return
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const appId = process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      `${headerType[0]!.toUpperCase()}${headerType.slice(1)}-header templates need META_APP_ID set (used for Meta’s Resumable Upload). Add it to your environment, or remove the ${headerType} header.`,
    )
  }

  const limits = MEDIA_LIMITS[headerType]

  // Fetch the sample media bytes (works for our uploaded chat-media URL
  // and for a manually-pasted public link).
  let res: Response
  try {
    res = await fetch(payload.header_media_url)
  } catch {
    throw new Error(`Could not fetch the header ${headerType} URL. Make sure it is publicly reachable.`)
  }
  if (!res.ok) {
    throw new Error(`Header ${headerType} URL returned ${res.status}. It must be publicly reachable.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !limits.allowedTypes.includes(contentType)) {
    throw new Error(`Header ${headerType} must be ${describeAllowedTypes(limits.allowedTypes)} (got ${contentType}).`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error(`Header ${headerType} is empty.`)
  }
  if (bytes.byteLength > limits.maxBytes) {
    throw new Error(
      `Header ${headerType} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${limits.maxBytes / 1024 / 1024} MB.`,
    )
  }

  const mimeType = limits.allowedTypes.includes(contentType) ? contentType : limits.allowedTypes[0]!

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName: limits.fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
