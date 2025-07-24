const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const basicAuth = require('express-basic-auth');

const app = express();

// Enable CORS (allow all for now)
app.use(cors());

// Serve static files (client & admin UIs)
// app.use(express.static('public'));

app.get('/admin', basicAuth({
  users: { 'admin': 'digitalkeys' },
  challenge: true,
}), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// In-memory store of connected clients
const clients = new Map();

// Namespaces
let io;
let server;

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  // In production, use HTTPS (ensure your SSL certs are correct)
  const options = {
    key: fs.readFileSync('/path/to/ssl/key.pem'),
    cert: fs.readFileSync('/path/to/ssl/cert.pem'),
  };
  server = https.createServer(options, app);
} else {
  // In development, use HTTP
  server = http.createServer(app);
}

io = new Server(server, {
  cors: {
    origin: '*', // adjust this for stricter rules
    methods: ['GET', 'POST'],
  }
});

const clientNS = io.of('/client');
const adminNS = io.of('/admin');

// Helper: emit updated client list to all admins
function updateAdminClientList() {
  const list = Array.from(clients.keys());
  adminNS.emit('clientList', list);
}

// Client namespace
clientNS.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  clients.set(socket.id, { socket, messages: [] });
  updateAdminClientList();

  socket.on('message', (msg) => {
    console.log(`Message from client ${socket.id}: ${msg}`);
    const clientData = clients.get(socket.id);
    if (clientData) clientData.messages.push({ from: 'client', text: msg });
    adminNS.emit('newMessage', { clientId: socket.id, from: 'client', text: msg });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    clients.delete(socket.id);
    updateAdminClientList();
    adminNS.emit('sessionClosed', socket.id);
  });
});

// Admin namespace
adminNS.on('connection', (socket) => {
  console.log(`Admin connected: ${socket.id}`);
  updateAdminClientList();

  socket.on('joinSession', (clientId) => {
    console.log(`Admin ${socket.id} joined session with client ${clientId}`);
    socket.join(clientId);
    const clientData = clients.get(clientId);
    socket.emit('chatHistory', { clientId, messages: clientData ? clientData.messages : [] });
  });

  socket.on('leaveSession', (clientId) => {
    console.log(`Admin ${socket.id} left session with client ${clientId}`);
    socket.leave(clientId);
  });

  socket.on('message', ({ clientId, text }) => {
    console.log(`Message from admin ${socket.id} to client ${clientId}: ${text}`);
    const clientData = clients.get(clientId);
    if (clientData) clientData.messages.push({ from: 'admin', text });
    clientNS.to(clientId).emit('newMessage', { from: 'admin', text });
  });
});

// Start server
const PORT = process.env.PORT || (isProd ? 8443 : 3010);
server.listen(PORT, () => {
  console.log(`${isProd ? 'HTTPS' : 'HTTP'} server running on port ${PORT}`);
});
