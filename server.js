const express = require('express');
const cors = require('cors');
const { pgPool, getMongoDb } = require('./db');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// Инициализация Telegram-бота
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
let bot = null;

if (botToken && botToken.trim() !== '') {
  try {
    bot = new TelegramBot(botToken.trim(), { polling: true });
    console.log('🤖 Telegram-бот успешно запущен!');
  } catch (e) {
    console.error('Ошибка инициализации Telegram бота:', e.message);
  }
} else {
  console.log('⚠️ Telegram-бот не запущен: проверьте TELEGRAM_BOT_TOKEN в .env');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>'"]/g, '').trim();
}

// 1. Список блюд (PostgreSQL)
app.get('/api/dishes', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM dishes');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Блюдо по ID
app.get('/api/dishes/:id', async (req, res) => {
  try {
    const dishId = parseInt(req.params.id);
    const result = await pgPool.query('SELECT * FROM dishes WHERE dish_id = $1', [dishId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Блюдо не найдено' });
    }
    res.json({ success: true, dish: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Оформление заказа (PostgreSQL Transaction + MongoDB + Telegram)
app.post('/api/orders', async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { items, customer_id } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Корзина пуста' });
    }

    await client.query('BEGIN');

    let totalAmount = 0;
    for (const item of items) {
      const dishRes = await client.query('SELECT price, stock_quantity FROM dishes WHERE dish_id = $1 FOR UPDATE', [item.dish_id]);
      if (dishRes.rows.length === 0) throw new Error(`Блюдо ID ${item.dish_id} не найдено`);
      
      const dish = dishRes.rows[0];
      if (dish.stock_quantity < item.quantity) throw new Error(`Недостаточно товара ID ${item.dish_id}`);

      totalAmount += Number(dish.price) * item.quantity;
    }

    const orderRes = await client.query(
      'INSERT INTO orders (customer_id, total_amount, status) VALUES ($1, $2, $3) RETURNING order_id',
      [customer_id || 1, totalAmount, 'COMPLETED']
    );
    const orderId = orderRes.rows[0].order_id;

    for (const item of items) {
      const dishRes = await client.query('SELECT price FROM dishes WHERE dish_id = $1', [item.dish_id]);
      await client.query(
        'INSERT INTO order_items (order_id, dish_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.dish_id, item.quantity, dishRes.rows[0].price]
      );
      await client.query(
        'UPDATE dishes SET stock_quantity = stock_quantity - $1 WHERE dish_id = $2',
        [item.quantity, item.dish_id]
      );
    }

    await client.query('COMMIT');

    // Лог в MongoDB
    try {
      const mongoDb = getMongoDb();
      await mongoDb.collection('order_logs').insertOne({
        order_id: orderId,
        total_amount: totalAmount,
        items_count: items.length,
        created_at: new Date(),
        status: 'SUCCESS'
      });
    } catch (mErr) {
      console.error('MongoDB Log Error:', mErr.message);
    }

    // Сообщение в Telegram
    if (bot && chatId) {
      const itemsList = items.map(i => `• ${i.name} × ${i.quantity} шт.`).join('\n');
      const message = `🛍 *НОВЫЙ ЗАКАЗ #${orderId}*\n\n📋 *Состав:* \n${itemsList}\n\n💰 *Итого:* ${Number(totalAmount).toLocaleString('ru-RU')} сум`;
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(err => console.error('Telegram Error:', err.message));
    }

    res.status(201).json({ success: true, order_id: orderId, total_amount: totalAmount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 4. Аналитика PostgreSQL
app.get('/api/analytics/summary', async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(AVG(total_amount), 0) AS avg_order_value
      FROM orders
    `);
    res.json({ success: true, summary: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Логи MongoDB
app.get('/api/analytics/logs', async (req, res) => {
  try {
    const mongoDb = getMongoDb();
    const logs = await mongoDb.collection('order_logs').find({}).sort({ created_at: -1 }).limit(10).toArray();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Продвинутая агрегация MongoDB
app.get('/api/analytics/advanced', async (req, res) => {
  try {
    const mongoDb = getMongoDb();
    const statsByStatus = await mongoDb.collection('order_logs').aggregate([
      {
        $group: {
          _id: "$status",
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$total_amount" },
          avgRevenue: { $avg: "$total_amount" }
        }
      },
      {
        $project: {
          status: "$_id",
          totalOrders: 1,
          totalRevenue: 1,
          avgRevenue: { $round: ["$avgRevenue", 2] },
          _id: 0
        }
      }
    ]).toArray();
    res.json({ success: true, stats: statsByStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 OshPOS Server running on http://localhost:${PORT}`));