import { FINCAS, nombreFinca, UMBRAL_TEMP, UMBRAL_CO2, MAX_HISTORIAL } from './config.js';
import { formatearHora } from './utils.js';

const METRICAS = {
    temperatura: { label: "Temperatura", unidad: "°C", umbral: UMBRAL_TEMP },
    humedad: { label: "Humedad", unidad: "%", umbral: null },
    co2: { label: "CO₂", unidad: "ppm", umbral: UMBRAL_CO2 },
};

const COLORES = ["#e8a838", "#2dd4bf", "#a78bfa", "#34C759", "#f472b6", "#60a5fa"];

// datos[finca] = [{t: iso, temperatura, humedad, co2}, ...] (orden cronologico)
const datos = Object.fromEntries(FINCAS.map(f => [f, []]));
let chart = null;
let metrica = "temperatura";
let fincaSel = "todas";

export function iniciarGrafica() {
    if (typeof Chart === "undefined") {
        document.getElementById("chart-summary").textContent = "No se pudo cargar la librería de gráficas.";
        return;
    }
    const select = document.getElementById("chart-finca");
    select.innerHTML = `<option value="todas">Todas las fincas</option>` +
        FINCAS.map(f => `<option value="${f}">${nombreFinca(f)}</option>`).join("");
    select.addEventListener("change", () => { fincaSel = select.value; refrescar(); });

    document.querySelectorAll("#chart-metrics .pill").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#chart-metrics .pill").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            metrica = btn.dataset.metric;
            refrescar();
        });
    });

    Chart.defaults.color = "#8fa89a";
    Chart.defaults.font.family = "Inter, sans-serif";
    chart = new Chart(document.getElementById("trend-chart"), {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0.3, borderWidth: 2 } },
            scales: {
                x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { maxTicksLimit: 8 } },
                y: { grid: { color: "rgba(255,255,255,0.06)" }, title: { display: true, text: "" } },
            },
            plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
        },
    });
    refrescar();
}

export function cargarPuntosGrafica(finca, registrosCronologicos) {
    if (!datos[finca]) return;
    datos[finca] = registrosCronologicos.map(r => ({ ...r, t: r.timestamp }));
    refrescar();
}

export function agregarPuntoGrafica(reg) {
    const serie = datos[reg.finca_id];
    if (!serie) return;
    serie.push({ ...reg, t: reg.timestamp });
    if (serie.length > MAX_HISTORIAL) serie.shift();
    refrescar();
}

function refrescar() {
    if (!chart) return;
    const m = METRICAS[metrica];
    const fincas = fincaSel === "todas" ? FINCAS : [fincaSel];

    // El eje X toma la serie mas larga; las demas se alinean por el final.
    const base = fincas.map(f => datos[f]).reduce((a, b) => (b.length > a.length ? b : a), []);
    chart.data.labels = base.map(p => formatearHora(p.t));

    chart.data.datasets = fincas.map(f => {
        const serie = datos[f].map(p => p[metrica]);
        const pad = Array(Math.max(0, base.length - serie.length)).fill(null);
        return {
            label: nombreFinca(f),
            data: [...pad, ...serie],
            borderColor: COLORES[FINCAS.indexOf(f) % COLORES.length],
            backgroundColor: COLORES[FINCAS.indexOf(f) % COLORES.length],
            spanGaps: true,
        };
    });
    if (m.umbral !== null) {
        chart.data.datasets.push({
            label: `Umbral de alerta (${m.umbral} ${m.unidad})`,
            data: base.map(() => m.umbral),
            borderColor: "#ff6b6b",
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            hoverRadius: 0,
        });
    }
    chart.options.scales.y.title.text = `${m.label} (${m.unidad})`;
    chart.update();
    resumen(m);
}

function resumen(m) {
    const el = document.getElementById("chart-summary");
    const ultimos = FINCAS.filter(f => datos[f].length).map(f => ({ f, v: datos[f][datos[f].length - 1][metrica] }));
    if (!ultimos.length) { el.textContent = "Esperando datos…"; return; }

    const prom = ultimos.reduce((s, u) => s + u.v, 0) / ultimos.length;
    const max = ultimos.reduce((a, b) => (b.v > a.v ? b : a));
    const min = ultimos.reduce((a, b) => (b.v < a.v ? b : a));
    const fmt = v => `${v.toFixed(1)} ${m.unidad}`;

    let texto = `${m.label} actual — promedio de las fincas: <strong>${fmt(prom)}</strong>. ` +
        `Más alta: <strong>${nombreFinca(max.f)}</strong> (${fmt(max.v)}). ` +
        `Más baja: <strong>${nombreFinca(min.f)}</strong> (${fmt(min.v)}).`;

    if (m.umbral !== null) {
        const sobre = ultimos.filter(u => u.v > m.umbral);
        texto += sobre.length
            ? ` <span class="summary-alert">${sobre.length} de ${ultimos.length} fincas superan el umbral de ${m.umbral} ${m.unidad}: ${sobre.map(u => nombreFinca(u.f)).join(", ")}.</span>`
            : ` Todas las fincas están por debajo del umbral de ${m.umbral} ${m.unidad}.`;
    }

    if (fincaSel !== "todas" && datos[fincaSel].length > 2) {
        const s = datos[fincaSel];
        const diff = s[s.length - 1][metrica] - s[Math.max(0, s.length - 6)][metrica];
        const tend = Math.abs(diff) < 0.5 ? "estable" : diff > 0 ? "al alza ▲" : "a la baja ▼";
        texto += ` Tendencia de ${nombreFinca(fincaSel)} en las últimas lecturas: <strong>${tend}</strong>.`;
    }
    el.innerHTML = texto;
}
