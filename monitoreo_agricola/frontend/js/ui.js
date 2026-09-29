import { UMBRAL_TEMP, UMBRAL_CO2, MAX_HISTORIAL, INTERVALO_ALERTAS_MS } from './config.js';
import { formatearHora, pct } from './utils.js';

const ultimasAlertas = {};

export function mostrarToast(mensaje) {
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

    setTimeout(() => {
        toast.style.animation = "toast-out 0.35s ease forwards";
        toast.addEventListener("animationend", () => toast.remove());
    }, 5000);
}

export function actualizarTarjeta(datos) {
    const id = datos.finca_id;

    const tempEl = document.getElementById(`temp-${id}`);
    const humEl = document.getElementById(`hum-${id}`);
    const co2El = document.getElementById(`co2-${id}`);

    [tempEl, humEl, co2El].forEach(el => {
        el.classList.remove("value-updated");
        void el.offsetWidth;
        el.classList.add("value-updated");
    });

    tempEl.textContent = datos.temperatura;
    humEl.textContent = datos.humedad;
    co2El.textContent = datos.co2;

    document.getElementById(`time-${id}`).textContent = formatearHora(datos.timestamp);

    document.getElementById(`bar-temp-${id}`).style.width = pct(datos.temperatura, 15, 40) + "%";
    document.getElementById(`bar-hum-${id}`).style.width = pct(datos.humedad, 0, 100) + "%";
    document.getElementById(`bar-co2-${id}`).style.width = pct(datos.co2, 300, 1200) + "%";

    const tempMetric = document.getElementById(`metric-temp-${id}`);
    const co2Metric = document.getElementById(`metric-co2-${id}`);

    if (tempMetric) tempMetric.classList.toggle("metric-alert", datos.temperatura > UMBRAL_TEMP);
    if (co2Metric) co2Metric.classList.toggle("metric-alert", datos.co2 > UMBRAL_CO2);

    const card = document.getElementById(`card-${id}`);
    const badge = document.getElementById(`badge-${id}`);
    const isAlert = datos.alerta === true;

    card.classList.toggle("alert-active", isAlert);
    badge.classList.toggle("visible", isAlert);

    if (isAlert) {
        const ahora = Date.now();
        const ultimaAlerta = ultimasAlertas[id] || 0;

        // Solo mostrar una alerta cada INTERVALO_ALERTAS_MS para no saturar la UI
        if (ahora - ultimaAlerta >= INTERVALO_ALERTAS_MS) {
            const reasons = [];
            if (datos.temperatura > UMBRAL_TEMP) reasons.push(`Temp ${datos.temperatura}C`);
            if (datos.co2 > UMBRAL_CO2) reasons.push(`CO2 ${datos.co2} ppm`);
            const fincaLabel = id === "finca_1" ? "Finca 1" : "Finca 2";
            mostrarToast(`${fincaLabel}: ${reasons.join(" - ")}`);
            
            ultimasAlertas[id] = ahora;
        }
    }
}

export function agregarFilaTabla(datos, prepend = true) {
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
