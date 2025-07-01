﻿const express = require('express');
const path = require('path');
const http = require('http');
const session = require('express-session');
const sharedSession = require("express-socket.io-session");
const { Server } = require("socket.io");
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const users = [
    { username: 'admin', password: 'admin123', role: 'admin', fullname: 'Administrador Principal' },
    { username: 'cliente', password: 'cliente123', role: 'client', fullname: 'Cliente Ejemplo' },
];

let productos = [];
let pedidos = [];

const sessionMiddleware = session({
    secret: 'mi_secreto_super_seguro',
    resave: false,
    saveUninitialized: false,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

io.use(sharedSession(sessionMiddleware, {
    autoSave: true
}));

// Usuarios pendientes por verificar email
const usuariosPendientes = {};

// Configura tu transporte de correo (Gmail con contraseña de aplicación)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'pepitoakcachofa20@gmail.com',           // ← Cambia aquí tu correo
        pass: 'yczagazesppihdjn'      // ← Cambia aquí la contraseña de aplicación
    }
});

// Registro con envío de código de verificación
app.post('/register', async (req, res) => {
    const { username, password, fullname, email } = req.body;

    if (users.some(u => u.username === username)) {
        return res.status(400).json({ message: 'El usuario ya existe' });
    }
    if (users.some(u => u.email === email) || usuariosPendientes[email]) {
        return res.status(400).json({ message: 'El correo ya está registrado' });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000); // código 6 dígitos

    usuariosPendientes[email] = { username, password, fullname, email, codigo };

    try {
        await transporter.sendMail({
            from: 'Tu App <tucorreo@gmail.com>',
            to: email,
            subject: 'Código de verificación',
            text: `Hola ${fullname}, tu código de verificación es: ${codigo}`
        });

        res.json({ message: 'Código de verificación enviado al correo' });
    } catch (error) {
        console.error('Error enviando correo:', error);
        res.status(500).json({ message: 'No se pudo enviar el correo' });
    }
});

// Verificar código
app.post('/verify', (req, res) => {
    const { email, code } = req.body;
    const userPendiente = usuariosPendientes[email];

    if (!userPendiente) {
        return res.status(400).json({ message: 'Correo no encontrado o ya verificado' });
    }

    if (userPendiente.codigo == code) {
        // Mover usuario a usuarios confirmados
        users.push({
            username: userPendiente.username,
            password: userPendiente.password,
            fullname: userPendiente.fullname,
            email: userPendiente.email,
            role: 'client'
        });
        delete usuariosPendientes[email];
        return res.json({ message: 'Correo verificado. Registro completado.' });
    } else {
        return res.status(400).json({ message: 'Código incorrecto' });
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = {
            username: user.username,
            role: user.role,
            fullname: user.fullname,
        };
        return res.json({ message: 'Login exitoso', role: user.role, fullname: user.fullname });
    } else {
        return res.status(401).json({ message: 'Usuario o contraseña incorrectos' });
    }
});

app.get('/session-info', (req, res) => {
    if (req.session.user) {
        res.json({
            username: req.session.user.username,
            fullname: req.session.user.fullname,
            role: req.session.user.role
        });
    } else {
        res.status(401).json({ message: 'No autenticado' });
    }
});

function authRole(role) {
    return (req, res, next) => {
        if (req.session.user && req.session.user.role === role) {
            next();
        } else {
            res.redirect('/login.html');
        }
    };
}

app.get('/admin.html', authRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/cliente.html', authRole('client'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.emit('productosActualizados', productos);
    socket.emit('pedidosActualizados', pedidos);

    socket.on('nuevoProducto', (producto) => {
        console.log('📦 Producto recibido en el servidor:', producto); // <-- ESTE ES EL PASO 2

        const nuevo = {
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            precio: producto.precio,
            imagen: producto.imagen,
            color: producto.color || '',
            disponibilidad: producto.disponibilidad || 'Disponible',
            categoria: producto.categoria || '',
            marca: producto.marca || '',
            oferta: producto.oferta || false,
            descuento: producto.descuento || 0
        };
        productos.push(nuevo);
        io.emit('productosActualizados', productos);
    });


    socket.on('eliminarProducto', (index) => {
        if (index >= 0 && index < productos.length) {
            productos.splice(index, 1);
            io.emit('productosActualizados', productos);
        }
    });

    socket.on('nuevoPedido', (pedido) => {
        const nombreCliente = socket.handshake.session.user?.fullname || 'Cliente Anónimo';
        const pedidoConNombre = {
            ...pedido,
            cliente: nombreCliente
        };
        pedidos.push(pedidoConNombre);
        io.emit('pedidosActualizados', pedidos);
    });

    socket.on('cambiarEstadoPedido', ({ index, estado }) => {
        if (index >= 0 && index < pedidos.length) {
            pedidos[index].estado = estado;
            io.emit('pedidosActualizados', pedidos);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
