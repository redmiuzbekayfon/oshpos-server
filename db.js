const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const pgPool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 10,
  idleTimeoutMillis: 30000,
});

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let mongoDb;

async function connectMongoDB() {
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    console.log('✅ Connected to MongoDB successfully!');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

connectMongoDB();

module.exports = {
  pgPool,
  getMongoDb: () => mongoDb,
};