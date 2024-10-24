// Connect to Socket.io server
const socket = io();

// DOM Elements
const loginModal = document.getElementById('login-modal');
const chatInterface = document.getElementById('chat-interface');
const username = document.getElementById('username');
const loginBtn = document.getElementById('login-btn');
const userProfile = document.getElementById('user-profile');
const newChatInput = document.getElementById('new-chat-input');
const createChatBtn = document.getElementById('create-chat-btn');
const chatList = document.getElementById('chat-list');
const currentChatName = document.getElementById('current-chat-name');
const onlineUsers = document.getElementById('online-users');
const leaveChat = document.getElementById('leave-chat');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendMessageBtn = document.getElementById('send-message-btn');

// App State
let currentUser = '';
let currentChat = '';
let activeChats = new Set();
let sessionId = localStorage.getItem('sessionId');

// Check for existing session on page load
window.addEventListener('load', () => {
    const savedUsername = localStorage.getItem('username');
    const savedChat = localStorage.getItem('currentChat');
    const savedChats = JSON.parse(localStorage.getItem('activeChats') || '[]');
    
    if (savedUsername && sessionId) {
        currentUser = savedUsername;
        socket.emit('user:resume', { username: savedUsername, sessionId });
        loginModal.classList.add('hidden');
        chatInterface.classList.remove('hidden');
        userProfile.textContent = currentUser;
        
        // Restore active chats
        savedChats.forEach(chat => {
            activeChats.add(chat);
            addChatToList(chat);
        });
        
        // Rejoin last active chat
        if (savedChat) {
            setTimeout(() => joinChat(savedChat), 500); // Small delay to ensure socket connection
        }
    }
});

// Login Handler
loginBtn.addEventListener('click', () => {
    if (username.value.trim()) {
        currentUser = username.value.trim();
        socket.emit('user:login', currentUser);
        localStorage.setItem('username', currentUser);
        loginModal.classList.add('hidden');
        chatInterface.classList.remove('hidden');
        userProfile.textContent = currentUser;
    }
});

// Session Management
socket.on('session:created', ({ sessionId: newSessionId }) => {
    sessionId = newSessionId;
    localStorage.setItem('sessionId', sessionId);
});

// Create New Chat
createChatBtn.addEventListener('click', () => {
    const chatName = newChatInput.value.trim();
    if (chatName) {
        joinChat(chatName);
        newChatInput.value = '';
    }
});

// Send Message
sendMessageBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentChat) {
        socket.emit('message:send', {
            chat: currentChat,
            user: currentUser,
            text: message,
            timestamp: new Date().toISOString(),
            sessionId
        });
        messageInput.value = '';
    }
}

// Join Chat
function joinChat(chatName) {
    if (currentChat) {
        socket.emit('chat:leave', { 
            chat: currentChat, 
            user: currentUser,
            sessionId 
        });
    }
    
    currentChat = chatName;
    localStorage.setItem('currentChat', currentChat);
    
    socket.emit('chat:join', { 
        chat: chatName, 
        user: currentUser,
        sessionId 
    });
    
    updateActiveChatUI();
    saveActiveChats();
}

// Leave Chat
leaveChat.addEventListener('click', () => {
    if (currentChat) {
        socket.emit('chat:leave', { 
            chat: currentChat, 
            user: currentUser,
            sessionId 
        });
        currentChat = '';
        localStorage.removeItem('currentChat');
        updateActiveChatUI();
        messagesContainer.innerHTML = '';
        currentChatName.textContent = 'Select a chat';
        saveActiveChats();
    }
});

// Update UI
function updateActiveChatUI() {
    const chatItems = chatList.getElementsByClassName('chat-item');
    for (let item of chatItems) {
        item.classList.remove('active');
        if (item.dataset.chat === currentChat) {
            item.classList.add('active');
        }
    }
    
    if (currentChat) {
        currentChatName.textContent = `#${currentChat}`;
    }
}

function addChatToList(chatName) {
    if (!activeChats.has(chatName)) {
        activeChats.add(chatName);
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chat = chatName;
        chatItem.innerHTML = `
            <i class="fas fa-hashtag"></i>
            <span>${chatName}</span>
        `;
        chatItem.addEventListener('click', () => joinChat(chatName));
        chatList.appendChild(chatItem);
        saveActiveChats();
    }
}

function saveActiveChats() {
    localStorage.setItem('activeChats', JSON.stringify(Array.from(activeChats)));
}

function addMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.user === currentUser ? 'sent' : 'received'}`;
    messageDiv.innerHTML = `
        <strong>${message.user}</strong>
        <p>${message.text}</p>
        <small>${new Date(message.timestamp).toLocaleTimeString()}</small>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Socket Events
socket.on('chat:users', ({chat, users}) => {
    if (chat === currentChat) {
        onlineUsers.textContent = `${users.length} online`;
    }
});

socket.on('chat:message', message => {
    if (message.chat === currentChat) {
        addMessage(message);
    }
});

socket.on('chat:created', chatName => {
    addChatToList(chatName);
});

socket.on('chat:history', messages => {
    messagesContainer.innerHTML = '';
    messages.forEach(addMessage);
});

// Handle disconnection and reconnection
socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

socket.on('connect', () => {
    if (sessionId && currentUser) {
        socket.emit('user:resume', { 
            username: currentUser, 
            sessionId,
            currentChat 
        });
    }
});