const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'orders.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Internal reference to venom client
let venomClient = null;

// Allow external file (e.g. hotel-bot.js) to set the client
function setClient(client) {
  venomClient = client;
}

// Load orders
function loadOrders() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
  return JSON.parse(fs.readFileSync(DB_FILE));
}

// Save orders
function saveOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}

// Get all orders
app.get('/api/orders', (req, res) => {
  res.json(loadOrders());
});

// Update status (done/rejected) and notify guest
app.post('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const orders = loadOrders();

  const index = orders.findIndex(o => o.id == id);
  if (index === -1) return res.status(404).json({ error: 'Order not found' });

  orders[index].status = status;
  saveOrders(orders);

  const order = orders[index];
  const guestNumber = order.guestNumber;

  if (venomClient && guestNumber) {
    let msg = '';

    if (status === 'Done') {
      msg = `✅ Your order #${id} has been *completed*. Thank you for staying with us!`;
    } else if (status === 'Rejected') {
      msg = `❌ Your order #${id} was *rejected* by the manager. Please contact reception for help.`;
    }

    try {
      await venomClient.sendText(guestNumber, msg);
      console.log(`📩 Status "${status}" message sent to guest: ${guestNumber}`);
    } catch (err) {
      console.error('⚠️ Failed to notify guest via WhatsApp:', err.message);
    }
  }

  res.json({ success: true });
});

// Export app and setter function
module.exports = { app, setClient };

// Optional: If running directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
}
