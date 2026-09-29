import { WS_URL } from './config.js';
import { actualizarTarjeta, agregarFilaTabla } from './ui.js';

export function iniciarWebSocket() {
    const ws = new WebSocket(WS_URL);
    const badge = document.getElementById("ws-badge");
    const label = document.getElementById("ws-status-text");

    ws.onopen = () => {
        badge.classList.remove("offline");
        badge.classList.add("online");
        label.textContent = "En vivo";
    };

    ws.onmessage = (event) => {
        const datos = JSON.parse(event.data);
        actualizarTarjeta(datos);
        agregarFilaTabla(datos, true);
    };

    ws.onclose = () => {
        badge.classList.remove("online");
        badge.classList.add("offline");
        label.textContent = "Reconectando...";
        setTimeout(iniciarWebSocket, 3000);
    };

    ws.onerror = (err) => console.error("WebSocket Error:", err);
}
