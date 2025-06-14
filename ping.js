const http = require('http');
const server = http.createServer((req, res) => {
  res.end('Bot is running');
});
server.listen(process.env.PORT || 3000);
