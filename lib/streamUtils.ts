import { randomBytes } from "node:crypto";
import type { IStream } from "@/models/Stream";
import type { StreamDTO } from "@/types/stream";

/** Stable, unguessable public identifier (16 hex chars). */
export function generatePublicId(): string {
  return randomBytes(8).toString("hex");
}

/** Serialize a Mongoose Stream document to the dashboard DTO. */
export function toStreamDTO(doc: IStream): StreamDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    embedUrl: doc.embedUrl,
    publicId: doc.publicId,
    enabled: doc.enabled,
    status: doc.status,
    lastM3u8Url: doc.lastM3u8Url,
    lastHeaders: doc.lastHeaders,
    lastResolvedAt: doc.lastResolvedAt
      ? doc.lastResolvedAt.toISOString()
      : undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
