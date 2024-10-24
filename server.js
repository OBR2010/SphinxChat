const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Enhanced data structures for persistence
const chatRooms = new Map(); // Stores messages for each chat room
const userSessions = new Map(); // Maps session IDs to user data
const chatUsers = new Map(); // Stores active users in each chat room
const userSockets = new Map(); // Maps socket IDs to session IDs

// Session management
function createSession(username, socketId) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    userSessions.set(sessionId, {
        username,
        socketId,
        activeChats: new Set(),
        lastSeen: Date.now()
    });
    return sessionId;
}

function getSession(sessionId) {
    return userSessions.get(sessionId);
}

function updateSession(sessionId, socketId) {
    const session = userSessions.get(sessionId);
    if (session) {
        session.socketId = socketId;
        session.lastSeen = Date.now();
        return session;
    }
    return null;
}

// Initialize chat room
function initializeChatRoom(chatName) {
    if (!chatRooms.has(chatName)) {
        chatRooms.set(chatName, {
            messages: [],
            users: new Set(),
            lastActivity: Date.now()
        });
    }
    return chatRooms.get(chatName);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user login
    socket.on('user:login', (username) => {
        const sessionId = createSession(username, socket.id);
        userSockets.set(socket.id, sessionId);
        
        // Send session ID to client
        socket.emit('session:created', { sessionId });
        
        // Send existing chat rooms
        socket.emit('chat:list', Array.from(chatRooms.keys()));
    });

    // Handle session resume
    socket.on('user:resume', ({ username, sessionId, currentChat }) => {
        const session = getSession(sessionId);
        
        if (session) {
            // Update session with new socket
            session.socketId = socket.id;
            userSockets.set(socket.id, sessionId);
            
            // Rejoin active chats
            session.activeChats.forEach(chat => {
                socket.join(chat);
                const room = chatRooms.get(chat);
                if (room) {
                    room.users.add(username);
                }
            });
            
            // If user was in a chat, rejoin it
            if (currentChat) {
                const room = initializeChatRoom(currentChat);
                socket.join(currentChat);
                room.users.add(username);
                
                // Send chat history
                socket.emit('chat:history', room.messages);
                
                // Update user list
                io.to(currentChat).emit('chat:users', {
                    chat: currentChat,
                    users: Array.from(room.users)
                });
            }
        } else {
            // Session expired, create new session
            const newSessionId = createSession(username, socket.id);
            userSockets.set(socket.id, newSessionId);
            socket.emit('session:created', { sessionId: newSessionId });
        }
    });

    // Handle joining chat
    socket.on('chat:join', ({ chat, user, sessionId }) => {
        const session = getSession(sessionId);
        if (!session) return;
        
        const room = initializeChatRoom(chat);
        
        // Add chat to user's active chats
        session.activeChats.add(chat);
        
        // Join socket room
        socket.join(chat);
        room.users.add(user);
        room.lastActivity = Date.now();

        // Send chat history
        socket.emit('chat:history', room.messages);
        
        // Broadcast user list update
        io.to(chat).emit('chat:users', {
            chat,
            users: Array.from(room.users)
        });

        // Broadcast new chat room if it's new
        io.emit('chat:created', chat);
    });

    // Handle leaving chat
    socket.on('chat:leave', ({ chat, user, sessionId }) => {
        const session = getSession(sessionId);
        if (!session) return;
        
        handleLeaveChat(socket, chat, user, session);
    });

    // Handle messages
    socket.on('message:send', ({ chat, user, text, timestamp, sessionId }) => {
        const session = getSession(sessionId);
        if (!session) return;
        
        const room = chatRooms.get(chat);
        if (room) {
            const messageObj = { chat, user, text, timestamp };
            room.messages.push(messageObj);
            room.lastActivity = Date.now();

            // Keep only last 100 messages
            if (room.messages.length > 100) {
                room.messages.shift();
            }

            io.to(chat).emit('chat:message', messageObj);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const sessionId = userSockets.get(socket.id);
        if (sessionId) {
            const session = getSession(sessionId);
            if (session) {
                // Mark session as disconnected but don't remove it
                session.socketId = null;
                session.lastSeen = Date.now();
            }
            userSockets.delete(socket.id);
        }
    });
});

// Helper function to handle leaving a chat
function handleLeaveChat(socket, chat, user, session) {
    const room = chatRooms.get(chat);
    if (room) {
        room.users.delete(user);
        session.activeChats.delete(chat);
        socket.leave(chat);
        
        io.to(chat).emit('chat:users', {
            chat,
            users: Array.from(room.users)
        });
    }
}

// Cleanup inactive sessions and empty chat rooms
setInterval(() => {
    const now = Date.now();
    const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
    const ROOM_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Clean up inactive sessions
    for (const [sessionId, session] of userSessions.entries()) {
        if (!session.socketId && (now - session.lastSeen > SESSION_TIMEOUT)) {
            userSessions.delete(sessionId);
        }
    }

    // Clean up inactive chat rooms
    for (const [chatName, room] of chatRooms.entries()) {
        if (room.users.size === 0 && (now - room.lastActivity > ROOM_TIMEOUT)) {
            chatRooms.delete(chatName);
        }
    }
}, 3600000); // Run every hour

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});