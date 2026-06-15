import { MongoClient, type MongoClientOptions } from "mongodb";

// Native MongoClient promise — required by the NextAuth MongoDBAdapter.
// (Mongoose, in lib/db.ts, handles application models separately.)
//
// The client is created lazily on first use (request time) rather than at
// module import time. `next build` evaluates this module while collecting page
// data but has no MONGODB_URI, so eagerly constructing the client there made
// the driver call `uri.startsWith(...)` on `undefined` and crash the build.

const options: MongoClientOptions = {};

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  return new MongoClient(uri, options).connect();
}

// Memoized so the adapter (which calls this on every operation) reuses a single
// client/connection. In development the promise is cached on `global` to
// survive HMR module reloads.
export default function getMongoClient(): Promise<MongoClient> {
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = createClientPromise();
    }
    return global._mongoClientPromise;
  }

  if (!clientPromise) {
    clientPromise = createClientPromise();
  }
  return clientPromise;
}
