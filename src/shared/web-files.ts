import { z } from 'zod'

import { ipcResultSchema } from './errors.js'

export const webTransferTicketSchema = z.uuid()

export const webDirectoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['directory', 'file']),
})

export const webDirectoryListingSchema = z.object({
  path: z.string().min(1),
  parentPath: z.string().min(1).nullable(),
  entries: z.array(webDirectoryEntrySchema),
})

export const webDirectoryListingResultSchema = ipcResultSchema(webDirectoryListingSchema)

export const webDirectoryCreateRequestSchema = z.object({
  parentPath: z.string().min(1),
  name: z.string().trim().min(1).max(120),
})

export const webImportUploadSchema = z.object({
  ticket: webTransferTicketSchema,
  path: z.string().min(1),
  name: z.string().min(1),
})

export const webImportUploadResultSchema = ipcResultSchema(webImportUploadSchema)

export const webExportTicketRequestSchema = z.object({
  format: z.enum(['jsonl', 'html']),
  defaultFileName: z.string().trim().min(1).max(200),
})

export const webExportTicketSchema = z.object({
  ticket: webTransferTicketSchema,
  path: z.string().min(1),
  name: z.string().min(1),
})

export const webExportTicketResultSchema = ipcResultSchema(webExportTicketSchema)
export const webTransferReleaseRequestSchema = z.object({ ticket: webTransferTicketSchema })

export type WebDirectoryListing = z.infer<typeof webDirectoryListingSchema>
export type WebImportUpload = z.infer<typeof webImportUploadSchema>
export type WebExportTicket = z.infer<typeof webExportTicketSchema>
