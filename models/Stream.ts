import mongoose, { Schema, type Model, type Document, type Types } from "mongoose";
import type { SessionStatus, StreamHeaders } from "@/types/stream";

export type StreamStatus = SessionStatus | "unresolved";

export interface IStream extends Document {
  name: string;
  embedUrl: string;
  /** Stable, unguessable public identifier used in embed/proxy URLs. */
  publicId: string;
  enabled: boolean;
  status: StreamStatus;
  // Cached resolution (refreshed on demand / on 403):
  lastM3u8Url?: string;
  lastHeaders?: StreamHeaders;
  lastResolvedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HeadersSchema = new Schema<StreamHeaders>(
  {
    referer: String,
    origin: String,
    userAgent: String,
  },
  { _id: false },
);

const StreamSchema = new Schema<IStream>(
  {
    name: { type: String, required: true, trim: true },
    embedUrl: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["active", "refreshing", "failed", "unresolved"],
      default: "unresolved",
    },
    lastM3u8Url: { type: String },
    lastHeaders: { type: HeadersSchema },
    lastResolvedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const Stream: Model<IStream> =
  (mongoose.models.Stream as Model<IStream>) ??
  mongoose.model<IStream>("Stream", StreamSchema);
