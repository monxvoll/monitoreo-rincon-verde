// Configuracion
const API_URL = "http://localhost:8000/api/historial";
const WS_URL = "ws://localhost:8000/ws/monitoreo";

const FINCAS = ["finca_1", "finca_2"];
const UMBRAL_TEMP = 30.0;
const UMBRAL_CO2 = 800.0;
const MAX_HISTORIAL = 50;

// Utilidades

function formatearHora(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function pct(value, min, max) {
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

// Notificaciones toast para alertas

function mostrarToast(mensaje) {
    const container = document.getElementById("toast-container");

    const toast = document.createElement("div");
    toast.className = "toast alert";
    toast.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>${mensaje}</span>
    `;

    container.appendChild(toast);

    // Desaparece automaticamente a los 5 segundos
    setTimeout(() => {
        toast.style.animation = "toast-out 0.35s ease forwards";
        toast.addEventListener("animationend", () => toast.remove());
    }, 5000);
}

// Actualizacion de las tarjetas superiores con el ultimo dato

function actualizarTarjeta(datos) {
    const id = datos.finca_id;

    // Actualizar valores con animacion flash
    const tempEl = document.getElementById(`temp-${id}`);
    const humEl  = document.getElementById(`hum-${id}`);
    const co2El  = document.getElementById(`co2-${id}`);

    [tempEl, humEl, co2El].forEach(el => {
        el.classList.remove("value-updated");
        void el.offsetWidth;
        el.classList.add("value-updated");
    });

    tempEl.textContent = datos.temperatura;
    humEl.textContent  = datos.humedad;
    co2El.textContent  = datos.co2;

    // Actualizar timestamp
    document.getElementById(`time-${id}`).textContent = formatearHora(datos.timestamp);

    // Actualizar barras de progreso segun el rango del sensor
    document.getElementById(`bar-temp-${id}`).style.width = pct(datos.temperatura, 15, 40) + "%";
    document.getElementById(`bar-hum-${id}`).style.width  = pct(datos.humedad, 0, 100) + "%";
    document.getElementById(`bar-co2-${id}`).style.width  = pct(datos.co2, 300, 1200) + "%";

    // Resaltar metricas individuales si superan el umbral
    const tempMetric = document.getElementById(`metric-temp-${id}`);
    const co2Metric  = document.getElementById(`metric-co2-${id}`);

    if (tempMetric) tempMetric.classList.toggle("metric-alert", datos.temperatura > UMBRAL_TEMP);
    if (co2Metric)  co2Metric.classList.toggle("metric-alert", datos.co2 > UMBRAL_CO2);

    // Estado de alerta a nivel de tarjeta
    const card  = document.getElementById(`card-${id}`);
    const badge = document.getElementById(`badge-${id}`);
    const isAlert = datos.alerta === true;

    card.classList.toggle("alert-active", isAlert);
    badge.classList.toggle("visible", isAlert);

    // Mostrar toast si hay alerta
    if (isAlert) {
        const reasons = [];
        if (datos.temperatura > UMBRAL_TEMP) reasons.push(`Temp ${datos.temperatura}C`);
        if (datos.co2 > UMBRAL_CO2) reasons.push(`CO2 ${datos.co2} ppm`);
        const fincaLabel = id === "finca_1" ? "Finca 1" : "Finca 2";
        mostrarToast(`${fincaLabel}: ${reasons.join(" - ")}`);
    }
}

// Tabla de historial

function agregarFilaTabla(datos, prepend = true) {
    const id = datos.finca_id;
    const tbody = document.getElementById(`table-${id}`);

    const isAlert = datos.temperatura > UMBRAL_TEMP || datos.co2 > UMBRAL_CO2;

    const tr = document.createElement("tr");
    tr.className = isAlert ? "row-alert" : "";
    if (prepend) tr.classList.add("row-new");

    tr.innerHTML = `
        <td>${formatearHora(datos.timestamp)}</td>
        <td>${datos.temperatura}</td>
        <td>${datos.humedad}</td>
        <td>${datos.co2}</td>
    `;

    if (prepend) {
        tbody.prepend(tr);
        while (tbody.children.length > MAX_HISTORIAL) {
            tbody.removeChild(tbody.lastChild);
        }
    } else {
        tbody.appendChild(tr);
    }
}

// Carga inicial del historial mediante REST

async function cargarHistorial() {
    for (const finca of FINCAS) {
        try {
            const res = await fetch(`${API_URL}/${finca}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const tbody = document.getElementById(`table-${finca}`);
            tbody.innerHTML = "";

            data.historial.forEach((reg, i) => {
                reg.finca_id = finca;
                reg.alerta = reg.temperatura > UMBRAL_TEMP || reg.co2 > UMBRAL_CO2;
                agregarFilaTabla(reg, false);

                // El primer registro es el mas reciente, actualizar la tarjeta
                if (i === 0) actualizarTarjeta(reg);
            });
        } catch (err) {
            console.error(`Error cargando historial de ${finca}:`, err);
        }
    }
}

// Conexion WebSocket para tiempo real

function iniciarWebSocket() {
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

// Inicializacion de la aplicacion

document.addEventListener("DOMContentLoaded", () => {
    cargarHistorial().then(() => iniciarWebSocket());
});
