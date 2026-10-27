const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Подключение к PostgreSQL (Supabase) через единый DATABASE_URL с поддержкой SSL
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
  }
}

module.exports = {
  pgPool,
  connectMongoDB,
  getMongoDb: () => mongoDb
};