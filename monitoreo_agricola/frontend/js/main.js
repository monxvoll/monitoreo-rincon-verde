import { cargarHistorial } from './api.js';
import { iniciarWebSocket } from './websocket.js';
import { renderFincas } from './render.js';
import { iniciarGrafica } from './chart.js';

document.addEventListener("DOMContentLoaded", () => {
    renderFincas();
    iniciarGrafica();
    cargarHistorial().then(() => iniciarWebSocket());
});
