import { FINCAS, nombreFinca } from './config.js';

const ICON_HOME = `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />`;

function metricBox({ key, id, label, unit, icon }) {
    return `
    <div id="metric-${key}-${id}" class="metric-box">
        <div class="metric-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
            ${label}
        </div>
        <div class="gauge-container">
            <svg class="gauge-svg" viewBox="0 0 120 120">
                <circle class="gauge-track" cx="60" cy="60" r="50" />
                <circle id="gauge-${key}-${id}" class="gauge-fill ${key}" cx="60" cy="60" r="50"
                    stroke-dasharray="314.16" stroke-dashoffset="314.16" />
            </svg>
            <div class="gauge-value">
                <div class="metric-value ${key}"><span id="${key}-${id}">--</span></div>
                <div class="metric-unit">${unit}</div>
            </div>
        </div>
    </div>`;
}

function crearTarjetaFinca(id) {
    const div = document.createElement("div");
    div.id = `card-${id}`;
    div.className = "finca-card";
    div.innerHTML = `
        <div class="card-header">
            <div class="card-header-left">
                <div class="finca-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_HOME}</svg></div>
                <span class="finca-name">${nombreFinca(id)}</span>
            </div>
            <div id="badge-${id}" class="alert-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Alerta
            </div>
        </div>
        <div class="metrics-row">
            ${metricBox({ key: "temp", id, label: "Temp", unit: "°C", icon: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />' })}
            ${metricBox({ key: "hum", id, label: "Humedad", unit: "%", icon: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />' })}
            ${metricBox({ key: "co2", id, label: "CO₂", unit: "ppm", icon: '<circle cx="12" cy="12" r="10" /><path d="M8 12h8" /><path d="M12 8v8" />' })}
        </div>
        <div class="card-footer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <span id="time-${id}">Sin datos</span>
        </div>`;
    return div;
}

function crearColumnaHistorial(id) {
    const div = document.createElement("div");
    div.className = "history-column";
    div.innerHTML = `
        <div class="column-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICON_HOME}</svg>
            ${nombreFinca(id)}
        </div>
        <table>
            <thead><tr><th>Hora</th><th>Temp °C</th><th>Hum %</th><th>CO₂ ppm</th></tr></thead>
            <tbody id="table-${id}"></tbody>
        </table>`;
    return div;
}

export function renderFincas() {
    const grid = document.getElementById("fincas-grid");
    const cols = document.getElementById("history-columns");
    FINCAS.forEach(id => {
        grid.appendChild(crearTarjetaFinca(id));
        cols.appendChild(crearColumnaHistorial(id));
    });
}
