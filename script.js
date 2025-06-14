const venom = require('venom-bot');
const fs = require('fs');
const path = require('path');
const { app, setClient } = require('./server'); // ⬅️ Connects Express API

// Hotel Configuration
const hotelConfig = {
  name: "Oceanview Resort",
  adminNumber: '9779819809195@c.us',
  receptionExtension: "22",
  databaseFile: path.join(__dirname, 'orders.json'),
  menu: { 
    breakfast: [
      "Continental Breakfast - ₹500",
      "Full English Breakfast - ₹750",
      "Pancakes with Maple Syrup - ₹450"
    ],
    lunch: [
      "Grilled Chicken Sandwich - ₹650",
      "Margherita Pizza - ₹800",
      "Vegetable Pasta - ₹550"
    ],
    dinner: [
      "Grilled Salmon - ₹1200",
      "Beef Steak - ₹1500",
      "Vegetable Curry - ₹600"
    ],
    roomService: [
      "Club Sandwich - ₹450",
      "Chicken Burger - ₹550",
      "Chocolate Lava Cake - ₹350"
    ]
  },
  hours: {
    breakfast: "7:00 AM - 10:30 AM",
    lunch: "12:00 PM - 3:00 PM",
    dinner: "6:30 PM - 11:00 PM",
    roomService: "24/7"
  },
  checkInTime: "2:00 PM",
  checkOutTime: "11:00 AM"
};

// Ensure DB file exists
if (!fs.existsSync(hotelConfig.databaseFile)) {
  fs.writeFileSync(hotelConfig.databaseFile, '[]');
}

const userStates = new Map();

venom.create({ session: 'hotel-bot', headless: true }).then(client => {
  console.log("✅ WhatsApp Bot Ready");
  setClient(client); // 🔗 Link Express API to WhatsApp bot

  app.listen(3000, () => {
    console.log('🌐 Dashboard running at http://localhost:3000');
  });

  client.onMessage(async (message) => {
    if (!message.body || message.isGroupMsg) return;

    const from = message.from;
    const userMsg = message.body.trim().toLowerCase();

    if (from === hotelConfig.adminNumber && await handleManagerCommands(client, userMsg)) return;
    if (await handleOngoingConversation(client, from, userMsg)) return;

    if (userMsg.includes('menu') || userMsg.includes('food')) return await sendFullMenu(client, from);
    if (userMsg.includes('order')) {
      await client.sendText(from, "🛎️ Please enter your room number (e.g. 101):");
      userStates.set(from, { step: 'awaiting_room' });
      return;
    }
    if (userMsg.includes('check-in')) return await sendCheckInInfo(client, from);
    if (userMsg.includes('housekeeping')) return await sendHousekeepingInfo(client, from);

    await sendWelcomeMessage(client, from);
  });

}).catch(console.error);

// --- Manager command handling
async function handleManagerCommands(client, message) {
  const confirmMatch = message.match(/^confirm\s+#(\d{13,})$/);
  const doneMatch = message.match(/^done\s+#(\d{13,})$/);

  if (confirmMatch) return await updateOrderStatus(client, confirmMatch[1], "Confirmed");
  if (doneMatch) return await updateOrderStatus(client, doneMatch[1], "Completed");
  return false;
}

async function updateOrderStatus(client, orderId, newStatus) {
  const orders = JSON.parse(fs.readFileSync(hotelConfig.databaseFile));
  const orderIndex = orders.findIndex(o => o.id.toString() === orderId);
  if (orderIndex === -1) {
    await client.sendText(hotelConfig.adminNumber, `⚠️ Order #${orderId} not found.`);
    return true;
  }

  const order = orders[orderIndex];
  orders[orderIndex].status = newStatus;
  fs.writeFileSync(hotelConfig.databaseFile, JSON.stringify(orders, null, 2));

  // Notify manager
  await client.sendText(hotelConfig.adminNumber, `✅ Order #${orderId} updated to *${newStatus}*.`);

  // Notify guest
  const guestMsg = newStatus === "Confirmed"
    ? `🛎️ Your order #${orderId} has been *confirmed* by the manager.`
    : `✅ Your order #${orderId} has been *completed*. Enjoy your meal!`;

  await client.sendText(order.guestNumber, guestMsg).catch(err => {
    console.error("❌ Failed to notify guest:", err.message);
  });

  return true;
}

// --- Guest conversation handling
async function handleOngoingConversation(client, guestNumber, userMsg) {
  if (!userStates.has(guestNumber)) return false;
  const state = userStates.get(guestNumber);

  if (state.step === 'awaiting_room') {
    if (!/^\d{3,4}$/.test(userMsg)) {
      await client.sendText(guestNumber, "🚫 Invalid room number. Please enter a 3-4 digit number:");
      return true;
    }
    userStates.set(guestNumber, { step: 'awaiting_order', room: userMsg });
    await client.sendText(guestNumber, `✅ Room ${userMsg} noted. Now enter the items you want to order.`);
    return true;
  }

  if (state.step === 'awaiting_order') {
    const items = findOrderItems(userMsg);
    if (!items.length) {
      await client.sendText(guestNumber, "⚠️ No valid item found. Please check the menu.");
      return true;
    }
    userStates.set(guestNumber, { ...state, step: 'awaiting_confirmation', items });
    await client.sendText(
      guestNumber,
      `🧾 Confirm your order:\nRoom: ${state.room}\nItems:\n${items.join('\n')}\n\nReply "confirm" to place the order.\n\n Reply "Cancel" to cancel your order.`
    );
    return true;
  }

  if (state.step === 'awaiting_confirmation' && userMsg === 'confirm') {
    const orderId = Date.now();
    const newOrder = {
      id: orderId,
      room: state.room,
      items: state.items,
      guestNumber: guestNumber,
      status: "Pending",
      timestamp: new Date().toISOString()
    };

    const orders = JSON.parse(fs.readFileSync(hotelConfig.databaseFile));
    orders.push(newOrder);
    fs.writeFileSync(hotelConfig.databaseFile, JSON.stringify(orders, null, 2));

    await notifyManager(client, `📢 *NEW ORDER*\n#${orderId}\n🏨 Room: ${state.room}\n🍽 Items:\n${state.items.join('\n')}`);
    await client.sendText(guestNumber, `✅ Order #${orderId} placed! Delivery in 30–45 mins.`);

    userStates.delete(guestNumber);
    return true;
  }

  return false;
}

function findOrderItems(msg) {
  const found = [];
  for (const category in hotelConfig.menu) {
    for (const item of hotelConfig.menu[category]) {
      const name = item.split(' - ')[0].toLowerCase();
      if (msg.includes(name)) found.push(item);
    }
  }
  return found;
}

async function notifyManager(client, text) {
  try {
    await client.sendText(hotelConfig.adminNumber, text);
  } catch (err) {
    console.error("❌ Failed to notify manager:", err.message);
  }
}

async function sendWelcomeMessage(client, number) {
  await client.sendText(number, `👋 Welcome to *${hotelConfig.name}*!\n\nReply:\n• "menu" to see food\n• "order" to place order\n• "check-in" info\n• "housekeeping" help`);
}

async function sendFullMenu(client, number) {
  let text = `📋 *Menu – ${hotelConfig.name}*\n\n reply "order" after choosing your food \n\n`;
  for (const category in hotelConfig.menu) {
    text += `🍽 ${category.toUpperCase()} (${hotelConfig.hours[category]}):\n`;
    text += hotelConfig.menu[category].map(item => `• ${item}`).join('\n') + '\n\n';
  }
  await client.sendText(number, text);
}

async function sendCheckInInfo(client, number) {
  await client.sendText(number, `🕒 *Check-in:* ${hotelConfig.checkInTime}\n🕚 *Check-out:* ${hotelConfig.checkOutTime}`);
}

async function sendHousekeepingInfo(client, number) {
  await client.sendText(number, `🧼 *Housekeeping Hours:* 8AM–6PM\n📞 Call ext. 55 for urgent cleaning requests.`);
}
