// ================= server.js =================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Указываем серверу раздавать статические файлы (твой index.html) из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище состояния: кто в какой комнате находится
const users = {}; // Формат: socket.id -> { username, room }

// Обработка подключений от клиентов
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // 1. Вход пользователя в комнату
    socket.on('join-room', ({ username, room, password }) => {
        // Простая проверка пароля для админки
        if (room === "Секретная Админка 🤫" && password !== "1234") { 
            return socket.emit('auth-error', 'Неверный пароль от админки!');
        }

        // Записываем пользователя в комнату
        socket.join(room);
        users[socket.id] = { username, room };

        // Ищем тех, кто УЖЕ находится в этой комнате, чтобы новичок мог им позвонить
        const roomUsers = Object.keys(users)
            .filter(id => users[id].room === room && id !== socket.id)
            .map(id => ({ id, username: users[id].username }));

        // Отвечаем лично новичку
        socket.emit('room-joined', { existingUsers: roomUsers, yourId: socket.id });

        // Оповещаем остальных участников комнаты
        socket.to(room).emit('sys-message', `${username} присоединился к комнате.`);
        
        // Обновляем список пользователей на экранах у всех в комнате
        updateUserList(room);
    });

    // 2. Ретрансляция WebRTC пакетов (SDP и ICE candidates) для видео/аудио
    socket.on('webrtc-signal', ({ to, signal }) => {
        io.to(to).emit('webrtc-signal', { from: socket.id, signal });
    });

    // 3. Текстовый чат
    socket.on('send-message', (text) => {
        const user = users[socket.id];
        if (user) {
            io.to(user.room).emit('new-message', { user: user.username, text });
        }
    });

    // 4. Остановка трансляции экрана
    socket.on('stop-screen-share', () => {
        const user = users[socket.id];
        if (user) {
            socket.to(user.room).emit('peer-stopped-screen', socket.id);
        }
    });

    // 5. Отключение пользователя (закрыл вкладку или пропал интернет)
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const room = user.room;
            
            // Говорим остальным разорвать WebRTC соединение с ним
            socket.to(room).emit('peer-left', socket.id);
            socket.to(room).emit('sys-message', `${user.username} покинул комнату.`);
            
            delete users[socket.id];
            updateUserList(room);
        }
        console.log('Отключение:', socket.id);
    });
});

// Вспомогательная функция рассылки списка юзеров
function updateUserList(room) {
    const roomUsers = Object.keys(users)
        .filter(id => users[id].room === room)
        .map(id => ({ id, username: users[id].username }));
    io.to(room).emit('user-list-update', roomUsers);
}

// Запуск сервера. process.env.PORT нужен для корректной работы на хостинге Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер успешно запущен на порту ${PORT}`);
});