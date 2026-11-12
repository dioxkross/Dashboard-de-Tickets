// ======================================
// ALMACÉN DE TICKETS
// Usa MySQL si está configurado y conecta; si no, un archivo JSON.
// ======================================
const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, 'data', 'tickets.json');

const SEMILLA = [
    ["Computadora no enciende", "Hardware", "Carlos Martínez", "PC-ADM-01", "Administración", "Urgente", "Abierto", "La computadora no enciende al presionar el botón de inicio.", "2026-11-12T08:30:00"],
    ["Sin conexión a Internet", "Redes", "María López", "PC-RH-03", "Recursos Humanos", "Alta", "En proceso", "El equipo perdió conexión con la red corporativa.", "2026-11-12T09:15:00"],
    ["Impresora no responde", "Hardware", "José Ramírez", "IMP-CONT-02", "Contabilidad", "Media", "Abierto", "La impresora no recibe los documentos enviados.", "2026-11-12T09:45:00"],
    ["Error al iniciar sesión", "Software", "Ana Torres", "PC-VEN-05", "Ventas", "Urgente", "En proceso", "El sistema muestra un error al ingresar las credenciales.", "2026-11-12T10:10:00"],
    ["Actualización de software", "Software", "Luis Hernández", "PC-ADM-04", "Administración", "Baja", "Resuelto", "Se solicitó actualizar el software de oficina.", "2026-11-11T15:20:00"],
    ["Falla en cable de red", "Redes", "Sofía García", "PC-ALM-02", "Almacén", "Alta", "Abierto", "El cable de red presenta desconexiones constantes.", "2026-11-12T11:00:00"],
    ["Monitor sin imagen", "Hardware", "Pedro Sánchez", "PC-DIR-01", "Dirección", "Media", "Resuelto", "El monitor no mostraba imagen al encender el equipo.", "2026-11-11T12:30:00"],
    ["Aplicación se cierra", "Software", "Laura Flores", "PC-RH-01", "Recursos Humanos", "Baja", "En proceso", "La aplicación administrativa se cierra inesperadamente.", "2026-11-12T11:30:00"]
].map((t, i) => ({
    id: 'TK-' + String(i + 1).padStart(3, '0'),
    client_id: 'seed-' + (i + 1),
    titulo: t[0], categoria: t[1], usuario: t[2], equipo: t[3],
    ubicacion: t[4], prioridad: t[5], estado: t[6], descripcion: t[7],
    fecha: t[8], updated_at: t[8]
}));

const CAMPOS = ['titulo', 'categoria', 'usuario', 'equipo', 'ubicacion', 'prioridad', 'estado', 'descripcion'];
const formatoId = n => 'TK-' + String(n).padStart(3, '0');

// ---------- JSON ----------
function crearAlmacenJSON() {
    let tickets = [];
    const guardar = () => {
        fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
        fs.writeFileSync(ARCHIVO, JSON.stringify(tickets, null, 2));
    };
    return {
        modo: 'json',
        async init() {
            try { tickets = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); }
            catch { tickets = SEMILLA.map(t => ({ ...t })); guardar(); }
        },
        async list(since) {
            return since ? tickets.filter(t => t.updated_at > since) : tickets;
        },
        async create(datos) {
            const existente = tickets.find(t => t.client_id === datos.client_id);
            if (existente) return { ticket: existente, nuevo: false };
            const n = tickets.reduce((m, t) => Math.max(m, parseInt(t.id.slice(3), 10) || 0), 0) + 1;
            const ahora = new Date().toISOString();
            const ticket = { id: formatoId(n), client_id: datos.client_id, ...datos.campos, fecha: datos.fecha || ahora, updated_at: ahora };
            tickets.push(ticket);
            guardar();
            return { ticket, nuevo: true };
        }
    };
}

// ---------- MySQL ----------
async function crearAlmacenMySQL() {
    const mysql = require('mysql2/promise');
    const { DB_HOST = 'localhost', DB_PORT = 3306, DB_USER, DB_PASSWORD = '', DB_NAME = 'tickets_ti' } = process.env;
    const admin = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    await admin.end();
    const pool = mysql.createPool({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, dateStrings: true });
    await pool.query(`CREATE TABLE IF NOT EXISTS tickets (
        num INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(64) NOT NULL UNIQUE,
        titulo VARCHAR(150) NOT NULL, categoria VARCHAR(30), usuario VARCHAR(100),
        equipo VARCHAR(60), ubicacion VARCHAR(100), prioridad VARCHAR(15) NOT NULL,
        estado VARCHAR(20) NOT NULL, descripcion TEXT,
        fecha VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL
    ) CHARACTER SET utf8mb4`);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tickets');
    const aTicket = r => ({ id: formatoId(r.num), client_id: r.client_id, ...Object.fromEntries(CAMPOS.map(c => [c, r[c]])), fecha: r.fecha, updated_at: r.updated_at });
    return {
        modo: 'mysql',
        async init() {
            if (total === 0) {
                for (const t of SEMILLA) {
                    await pool.query('INSERT INTO tickets (client_id,titulo,categoria,usuario,equipo,ubicacion,prioridad,estado,descripcion,fecha,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                        [t.client_id, ...CAMPOS.map(c => t[c]), t.fecha, t.updated_at]);
                }
            }
        },
        async list(since) {
            const [rows] = since
                ? await pool.query('SELECT * FROM tickets WHERE updated_at > ? ORDER BY num', [since])
                : await pool.query('SELECT * FROM tickets ORDER BY num');
            return rows.map(aTicket);
        },
        async create(datos) {
            const [prev] = await pool.query('SELECT * FROM tickets WHERE client_id = ?', [datos.client_id]);
            if (prev.length) return { ticket: aTicket(prev[0]), nuevo: false };
            const ahora = new Date().toISOString();
            const fecha = datos.fecha || ahora;
            const [r] = await pool.query('INSERT INTO tickets (client_id,titulo,categoria,usuario,equipo,ubicacion,prioridad,estado,descripcion,fecha,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [datos.client_id, ...CAMPOS.map(c => datos.campos[c]), fecha, ahora]);
            const [rows] = await pool.query('SELECT * FROM tickets WHERE num = ?', [r.insertId]);
            return { ticket: aTicket(rows[0]), nuevo: true };
        }
    };
}

async function crearAlmacen() {
    if (process.env.DB_USER) {
        try {
            const a = await crearAlmacenMySQL();
            await a.init();
            return a;
        } catch (e) {
            console.warn('No se pudo usar MySQL (' + e.message + '). Se usa archivo JSON.');
        }
    }
    const a = crearAlmacenJSON();
    await a.init();
    return a;
}

module.exports = { crearAlmacen, CAMPOS };
