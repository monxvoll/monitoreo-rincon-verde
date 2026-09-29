import { cargarHistorial } from './api.js';
import { iniciarWebSocket } from './websocket.js';

document.addEventListener("DOMContentLoaded", () => {
    cargarHistorial().then(() => iniciarWebSocket());
});
