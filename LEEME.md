# Dashboard de Tickets TI (PWA)

## Ejecutar
    npm install
    npm run dev
Abre http://localhost:3100

## Almacenamiento
- Por defecto guarda los tickets en `data/tickets.json` (se crea solo, con los 8 tickets de ejemplo).
- Para usar MySQL: copia `.env.example` a `.env`, llena `DB_USER` y `DB_PASSWORD` y reinicia.
  El servidor crea la base `tickets_ti` y la tabla solo. Si MySQL no conecta, usa el JSON y avisa en consola.

## Cómo funciona sin conexión
- Service Worker: la interfaz sale de caché al instante (nunca pantalla en blanco).
- IndexedDB: los tickets se guardan en el dispositivo. Un ticket creado sin red queda
  "Pendiente de envío" y se manda solo al volver la conexión (evento online, al reabrir la app
  y cada 20 s). Funciona también en iPhone (que no soporta Background Sync).
- Tiempo real: SSE (/api/stream) + sondeo de respaldo. Un ticket urgente nuevo muestra
  un banner rojo y hace vibrar el dispositivo.

## Probar offline
1. Abre la app con conexión y espera a que cargue.
2. DevTools > Network > Offline (o modo avión).
3. Crea un ticket: aparece como "Pendiente de envío". Recarga: sigue ahí.
4. Quita el modo offline: se envía solo y recibe su ID (TK-0XX).

## Probar el aviso de urgentes
Con la app abierta en una tablet o pestaña, crea un ticket Urgente desde otro dispositivo.
Para instalarla en iPhone se necesita HTTPS (Safari > Compartir > Añadir a pantalla de inicio).
