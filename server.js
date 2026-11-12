const express = require('express');
const path = require('path');
require('dotenv').config();
const { crearAlmacen, CAMPOS } = require('./store');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

// El Service Worker nunca debe quedarse en caché del navegador
app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

const PRIORIDADES = ['Urgente', 'Alta', 'Media', 'Baja'];
const ESTADOS = ['Abierto', 'En proceso', 'Resuelto'];
const clientes = new Set(); // conexiones SSE abiertas
let almacen;

app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Servidor de Tickets TI funcionando', almacenamiento: almacen?.modo, timestamp: new Date().toISOString() });
});

// Lista de tickets. ?since=<ISO> devuelve solo lo modificado después de esa fecha
app.get('/api/tickets', async (req, res) => {
    try {
        const tickets = await almacen.list(req.query.since);
        res.json({ success: true, tickets, serverTime: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al leer tickets' });
    }
});

// Crear ticket (idempotente por client_id: reenviar no duplica)
app.post('/api/tickets', async (req, res) => {
    const b = req.body || {};
    const limpio = v => String(v ?? '').trim().slice(0, 500);
    const campos = {};
    CAMPOS.forEach(c => { campos[c] = limpio(b[c]); });
    campos.estado = ESTADOS.includes(campos.estado) ? campos.estado : 'Abierto';

    const client_id = limpio(b.client_id).slice(0, 64);
    if (!client_id || !campos.titulo || !PRIORIDADES.includes(campos.prioridad)) {
        return res.status(400).json({ success: false, message: 'Datos incompletos: título, prioridad y client_id son obligatorios' });
    }
    const fecha = b.fecha && !isNaN(Date.parse(b.fecha)) ? new Date(b.fecha).toISOString() : undefined;

    try {
        const { ticket, nuevo } = await almacen.create({ client_id, campos, fecha });
        if (nuevo) {
            const msg = `event: ticket\ndata: ${JSON.stringify(ticket)}\n\n`;
            clientes.forEach(c => c.write(msg));
        }
        res.status(nuevo ? 201 : 200).json({ success: true, ticket });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Error al guardar el ticket' });
    }
});

// Tiempo real: avisa a todas las tablets cuando entra un ticket
app.get('/api/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    clientes.add(res);
    const latido = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(latido); clientes.delete(res); });
});

crearAlmacen().then(a => {
    almacen = a;
    app.listen(PORT, () => {
        console.log(`Servidor activo: http://localhost:${PORT}`);
        console.log(`Almacenamiento: ${a.modo === 'mysql' ? 'MySQL' : 'archivo JSON (data/tickets.json)'}`);
    });
});
