import { MongoClient, type MongoClientOptions } from "mongodb";

// Native MongoClient promise — required by the NextAuth MongoDBAdapter.
// (Mongoose, in lib/db.ts, handles application models separately.)

const uri = process.env.MONGODB_URI as string;
const options: MongoClientOptions = {};

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;
