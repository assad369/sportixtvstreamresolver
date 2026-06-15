// Seeds (or updates) the admin user from env. Run with:
//   pnpm seed   (→ node --env-file=.env.local scripts/seed-admin.mjs)
// Uses the native mongodb driver + bcryptjs so it needs no TS/Next runtime

import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD ?? "";
const dbName = process.env.MONGODB_DB ?? "sportix";

if (!uri) throw new Error("MONGODB_URI is not set.");
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set.");
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const users = client.db(dbName).collection("users");
  await users.createIndex({ email: 1 }, { unique: true });

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  const result = await users.updateOne(
    { email },
    {
      $set: { name: "Admin", email, passwordHash, role: "admin", updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  if (result.upsertedCount > 0) {
    console.log(`✓ Created admin user: ${email}`);
  } else {
    console.log(`✓ Updated admin user: ${email}`);
  }
} finally {
  await client.close();
}
