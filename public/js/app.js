// ======================================
// DASHBOARD DE SOPORTE TI
// Datos en IndexedDB (funciona sin conexión) + sincronización con el servidor
// ======================================

let tickets = [];                 // copia en memoria de lo guardado en IndexedDB
const nuevosUrgentes = new Set(); // client_id de urgentes recién llegados (resaltados)
let sincronizando = false;

// ======================================
// ELEMENTOS DEL DOM
// ======================================

const table = document.getElementById("ticketsTable");
const searchInput = document.getElementById("searchInput");
const priorityFilter = document.getElementById("priorityFilter");
const statusFilter = document.getElementById("statusFilter");

const totalElement = document.getElementById("totalTickets");
const openElement = document.getElementById("openTickets");
const progressElement = document.getElementById("progressTickets");
const urgentElement = document.getElementById("urgentTickets");

const modal = document.getElementById("ticketModal");
const details = document.getElementById("ticketDetails");
const newModal = document.getElementById("newTicketModal");
const banner = document.getElementById("urgentBanner");
const toast = document.getElementById("toast");

const safe = value => String(value ?? "").replace(
    /[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
);

function formatoFecha(f) {
    const d = new Date(f);
    return isNaN(d) ? safe(f) : d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

// ======================================
// INDEXEDDB
// ======================================

let dbPromise = null;

function abrirDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open("tickets-ti", 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore("tickets", { keyPath: "client_id" });
                req.result.createObjectStore("meta", { keyPath: "k" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

async function idb(store, modo, fn) {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, modo);
        const result = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
    });
}

const guardarTicket = t => idb("tickets", "readwrite", s => s.put(t));
const leerTickets = () => idb("tickets", "readonly", s => s.getAll());
const guardarMeta = (k, v) => idb("meta", "readwrite", s => s.put({ k, v }));
const leerMeta = async k => (await idb("meta", "readonly", s => s.get(k)))?.v;

// ======================================
// RED (con tiempo límite para no quedarse esperando)
// ======================================

async function api(url, opciones = {}, ms = 4000) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    try {
        return await fetch(url, { ...opciones, signal: control.signal });
    } finally {
        clearTimeout(reloj);
    }
}

// ======================================
// ESTADÍSTICAS
// ======================================

function updateStatistics() {
    totalElement.textContent = tickets.length;
    openElement.textContent = tickets.filter(t => t.estado === "Abierto").length;
    progressElement.textContent = tickets.filter(t => t.estado === "En proceso").length;
    urgentElement.textContent = tickets.filter(
        t => t.prioridad === "Urgente" && t.estado !== "Resuelto"
    ).length;
}

function updatePendingInfo() {
    const n = tickets.filter(t => t.pendiente).length;
    const el = document.getElementById("pendingInfo");
    el.textContent = n ? `${n} ticket(s) pendiente(s) de enviar` : "";
    el.classList.toggle("hidden", n === 0);
}

// ======================================
// MOSTRAR TICKETS
// ======================================

function renderTickets() {
    const search = searchInput.value.toLowerCase();
    const priority = priorityFilter.value;
    const status = statusFilter.value;

    const filteredTickets = tickets
        .filter(ticket => {
            const matchesSearch = [ticket.id, ticket.titulo, ticket.usuario, ticket.equipo, ticket.ubicacion]
                .some(value => String(value ?? "").toLowerCase().includes(search));
            return matchesSearch
                && (!priority || ticket.prioridad === priority)
                && (!status || ticket.estado === status);
        })
        .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));

    table.innerHTML = "";

    filteredTickets.forEach(ticket => {
        const row = document.createElement("tr");
        if (nuevosUrgentes.has(ticket.client_id)) row.classList.add("nuevo-urgente");

        row.innerHTML = `
            <td class="ticket-id">${ticket.pendiente ? "—" : safe(ticket.id)}</td>
            <td>
                <div class="ticket-title">
                    ${safe(ticket.titulo)}
                    ${ticket.pendiente ? '<span class="badge-pendiente">Pendiente de envío</span>' : ""}
                </div>
                <div class="ticket-category">${safe(ticket.categoria)}</div>
            </td>
            <td>${safe(ticket.usuario)}</td>
            <td>${safe(ticket.ubicacion)}</td>
            <td><span class="priority ${safe(ticket.prioridad)}">${safe(ticket.prioridad)}</span></td>
            <td><span class="status ${safe(String(ticket.estado).replaceAll(" ", "-"))}">${safe(ticket.estado)}</span></td>
        `;

        row.addEventListener("click", () => showTicketDetails(ticket.client_id));
        table.appendChild(row);
    });

    document.getElementById("ticketCount").textContent = `${filteredTickets.length} tickets`;
    document.getElementById("emptyState").classList.toggle("hidden", filteredTickets.length !== 0);
}

function actualizarVista() {
    updateStatistics();
    updatePendingInfo();
    renderTickets();
}

// ======================================
// DETALLE DEL TICKET
// ======================================

function showTicketDetails(clientId) {
    const ticket = tickets.find(item => item.client_id === clientId);
    if (!ticket) return;

    nuevosUrgentes.delete(clientId);
    renderTickets();

    const fila = (etiqueta, valor) =>
        `<div class="detail-row"><strong>${etiqueta}</strong>${safe(valor)}</div>`;

    details.innerHTML = `
        <h2>${safe(ticket.titulo)}</h2>
        ${fila("Identificador", ticket.pendiente ? "Se asignará al enviarse" : ticket.id)}
        ${fila("Usuario que reportó", ticket.usuario)}
        ${fila("Equipo", ticket.equipo)}
        ${fila("Ubicación", ticket.ubicacion)}
        ${fila("Categoría", ticket.categoria)}
        ${fila("Prioridad", ticket.prioridad)}
        ${fila("Estado", ticket.pendiente ? "Pendiente de envío (guardado en este dispositivo)" : ticket.estado)}
        <div class="detail-row"><strong>Fecha de reporte</strong>${formatoFecha(ticket.fecha)}</div>
        ${fila("Descripción", ticket.descripcion)}
    `;

    modal.classList.remove("hidden");
}

document.getElementById("closeModal").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });

// ======================================
// FILTROS
// ======================================

searchInput.addEventListener("input", renderTickets);
priorityFilter.addEventListener("change", renderTickets);
statusFilter.addEventListener("change", renderTickets);

// ======================================
// ESTADO DE CONEXIÓN
// (navigator.onLine miente con Wi-Fi sin Internet, así que
//  también cuenta si la última petición al servidor funcionó)
// ======================================

let servidorOk = navigator.onLine;

function setConexion(ok) {
    servidorOk = ok;
    const status = document.getElementById("connectionStatus");
    status.classList.toggle("online", ok);
    status.classList.toggle("offline", !ok);
    document.getElementById("connectionText").textContent = ok ? "Conectado" : "Sin conexión";
}

function mostrarUltimaSync(iso) {
    document.getElementById("lastSync").textContent = iso
        ? new Date(iso).toLocaleTimeString("es-MX")
        : "Pendiente";
}

// ======================================
// AVISO DE TICKET URGENTE
// ======================================

function avisarUrgente(t) {
    nuevosUrgentes.add(t.client_id);
    banner.textContent = `🚨 Ticket urgente nuevo: ${t.id} · ${t.titulo} · ${t.ubicacion || "sin ubicación"} (toca para verlo)`;
    banner.classList.remove("hidden");
    banner.onclick = () => {
        banner.classList.add("hidden");
        showTicketDetails(t.client_id);
    };
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// ======================================
// SINCRONIZACIÓN
// ======================================

// Mezcla tickets del servidor con lo local. Avisa si llegó un urgente que no se conocía.
async function integrar(lista, avisar) {
    for (const t of lista) {
        const conocido = tickets.find(x => x.client_id === t.client_id);
        const registro = { ...t, pendiente: false };
        if (conocido) Object.assign(conocido, registro);
        else tickets.push(registro);

        await guardarTicket(registro);

        if (avisar && !conocido && t.prioridad === "Urgente" && t.estado !== "Resuelto") {
            avisarUrgente(t);
        }
    }
    actualizarVista();
}

// Descarga lo nuevo del servidor
async function actualizar() {
    try {
        const since = await leerMeta("since");
        const yaTeniaDatos = tickets.length > 0;
        const resp = await api("/api/tickets" + (since ? `?since=${encodeURIComponent(since)}` : ""));
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();

        await integrar(data.tickets, yaTeniaDatos);
        await guardarMeta("since", data.serverTime);
        await guardarMeta("lastSync", new Date().toISOString());
        mostrarUltimaSync(new Date().toISOString());
        setConexion(true);
        return true;
    } catch {
        setConexion(false);
        return false;
    }
}

// Envía los tickets creados sin conexión
async function enviarPendientes() {
    const pendientes = tickets.filter(t => t.pendiente);
    let enviados = 0;

    for (const t of pendientes) {
        try {
            const resp = await api("/api/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(t)
            });
            if (resp.status === 400) { // datos inválidos: no tiene caso reintentar
                t.pendiente = false;
                t.id = "ERROR";
                await guardarTicket(t);
                continue;
            }
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const { ticket } = await resp.json();
            Object.assign(t, ticket, { pendiente: false });
            await guardarTicket(t);
            enviados++;
        } catch {
            setConexion(false);
            break; // sin red: se reintenta después
        }
    }

    actualizarVista();
    return enviados;
}

async function sincronizar(manual = false) {
    if (sincronizando) return;
    sincronizando = true;
    try {
        const enviados = await enviarPendientes();
        const ok = await actualizar();
        if (enviados) showToast(`${enviados} ticket(s) enviado(s) al servidor.`);
        if (manual) showToast(ok ? "Datos actualizados." : "Sin conexión. Mostrando datos guardados.");
    } finally {
        sincronizando = false;
    }
}

document.getElementById("refreshBtn").addEventListener("click", () => sincronizar(true));

window.addEventListener("online", () => { showToast("Conexión recuperada."); sincronizar(); });
window.addEventListener("offline", () => { setConexion(false); showToast("Sin conexión. Se muestran los datos guardados."); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });

// Aviso en tiempo real (SSE) + sondeo de respaldo cada 20 s
function conectarTiempoReal() {
    if (!("EventSource" in window)) return;
    const es = new EventSource("/api/stream");
    es.addEventListener("ticket", e => {
        integrar([JSON.parse(e.data)], true);
        setConexion(true);
    });
    es.onerror = () => { /* el navegador reintenta solo */ };
}

setInterval(() => { if (!document.hidden) sincronizar(); }, 20000);

// ======================================
// NUEVO TICKET (se guarda primero en el dispositivo)
// ======================================

const idLocal = () => (crypto.randomUUID ? crypto.randomUUID() : "c-" + Date.now() + "-" + Math.random().toString(16).slice(2));

document.getElementById("newTicketBtn").addEventListener("click", () => {
    newModal.classList.remove("hidden");
    document.getElementById("fTitulo").focus();
});
document.getElementById("closeNewTicket").addEventListener("click", () => newModal.classList.add("hidden"));
newModal.addEventListener("click", e => { if (e.target === newModal) newModal.classList.add("hidden"); });

document.getElementById("saveTicketBtn").addEventListener("click", async () => {
    const valor = id => document.getElementById(id).value.trim();
    const titulo = valor("fTitulo");
    if (!titulo) { showToast("Escribe un título para el ticket."); return; }

    const ticket = {
        client_id: idLocal(),
        id: "PENDIENTE",
        titulo,
        prioridad: valor("fPrioridad"),
        categoria: valor("fCategoria"),
        usuario: valor("fUsuario"),
        equipo: valor("fEquipo"),
        ubicacion: valor("fUbicacion"),
        descripcion: valor("fDescripcion"),
        estado: "Abierto",
        fecha: new Date().toISOString(),
        pendiente: true
    };

    await guardarTicket(ticket);
    tickets.push(ticket);
    actualizarVista();

    ["fTitulo", "fUsuario", "fEquipo", "fUbicacion", "fDescripcion"]
        .forEach(id => { document.getElementById(id).value = ""; });
    newModal.classList.add("hidden");
    showToast("Ticket guardado en este dispositivo.");

    sincronizar();
});

// ======================================
// NOTIFICACIONES
// ======================================

let toastTimer;
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// ======================================
// INICIALIZACIÓN
// ======================================

async function initializeDashboard() {
    document.getElementById("currentDate").textContent =
        new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    setConexion(navigator.onLine);

    // 1) Pinta al instante lo guardado en el dispositivo (nunca pantalla en blanco)
    try {
        tickets = await leerTickets();
        mostrarUltimaSync(await leerMeta("lastSync"));
    } catch { tickets = []; }
    actualizarVista();

    // 2) Después actualiza desde el servidor sin bloquear la pantalla
    await sincronizar();
    conectarTiempoReal();
}

initializeDashboard();

// Registrar Service Worker
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            await navigator.serviceWorker.register("/sw.js");
        } catch (error) {
            console.error("Error al registrar Service Worker:", error);
        }
    });
}
