import { formatearHora } from "./utils.js";
import { COMPARADOR_API_URL, COMPARADOR_WS_URL } from "./config.js";

const MAX_PUNTOS = 120;
const MAX_TABLA = 12;
const MOTORES = ["postgres", "redis"];
const NOMBRES = { postgres: "PostgreSQL", redis: "Redis" };
const COLORES = { postgres: "#60a5fa", redis: "#ff6b6b" };

let grafica = null;
let historial = [];
let metrica = "escritura";
let pausado = false;
let ultimoTimestamp = 0;
let temporizadorReconexion = null;

const formatoEntero = new Intl.NumberFormat("es-ES");

function numero(valor, decimales = 2) {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toFixed(decimales) : "--";
}

function iniciar() {
    crearGrafica();
    configurarControles();
    cargarResumenInicial();
    conectarWebSocket();
}

function crearGrafica() {
    const canvas = document.getElementById("compare-chart");
    if (!canvas || typeof Chart === "undefined") {
        return;
    }

    grafica = new Chart(canvas, {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    labels: {
                        color: "#8fa89a",
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { size: 11 },
                    },
                },
                tooltip: {
                    backgroundColor: "rgba(10, 26, 18, 0.95)",
                    borderColor: "rgba(52, 199, 89, 0.25)",
                    borderWidth: 1,
                    titleColor: "#e8f5e9",
                    bodyColor: "#8fa89a",
                    padding: 12,
                },
            },
            scales: {
                x: {
                    ticks: { color: "#5a7a68", maxTicksLimit: 8, font: { size: 10 } },
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: "Escritura (ms)",
                        color: "#5a7a68",
                        font: { size: 10 },
                    },
                    ticks: { color: "#5a7a68", font: { size: 10 } },
                    grid: { color: "rgba(255, 255, 255, 0.06)" },
                },
            },
        },
    });
}

function configurarControles() {
    const grupo = document.getElementById("chart-metrics");
    if (grupo) {
        grupo.addEventListener("click", (evento) => {
            const boton = evento.target.closest("button[data-metric]");
            if (!boton) {
                return;
            }
            metrica = boton.dataset.metric;
            grupo.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
            boton.classList.add("active");
            actualizarGrafica();
        });
    }

    const botonPausa = document.getElementById("pause-btn");
    if (botonPausa) {
        botonPausa.addEventListener("click", () => {
            pausado = !pausado;
            botonPausa.textContent = pausado ? "Reanudar" : "Pausar";
            botonPausa.classList.toggle("active", pausado);
        });
    }
}

async function cargarResumenInicial() {
    try {
        const respuesta = await fetch(COMPARADOR_API_URL, { cache: "no-store" });
        if (!respuesta.ok) {
            throw new Error(`HTTP ${respuesta.status}`);
        }
        aplicarSnapshot(await respuesta.json());
    } catch (error) {
        console.warn("No se pudo cargar el resumen inicial:", error);
    }
}

function conectarWebSocket() {
    if (temporizadorReconexion) {
        clearTimeout(temporizadorReconexion);
        temporizadorReconexion = null;
    }

    let socket;
    try {
        socket = new WebSocket(COMPARADOR_WS_URL);
    } catch (error) {
        console.warn("No se pudo crear el WebSocket:", error);
        programarReconexion();
        return;
    }

    socket.onopen = () => {
        actualizarConexion(true, "En vivo");
    };

    socket.onmessage = (evento) => {
        try {
            aplicarSnapshot(JSON.parse(evento.data));
        } catch (error) {
            console.warn("Mensaje WebSocket inválido:", error);
        }
    };

    socket.onerror = () => {
        actualizarConexion(false, "Sin conexión");
    };

    socket.onclose = () => {
        actualizarConexion(false, "Reconectando...");
        programarReconexion();
    };
}

function programarReconexion() {
    if (temporizadorReconexion) {
        return;
    }
    temporizadorReconexion = setTimeout(() => {
        temporizadorReconexion = null;
        conectarWebSocket();
    }, 3000);
}

function actualizarConexion(conectado, texto) {
    const badge = document.getElementById("compare-badge");
    const estado = document.getElementById("compare-status");
    if (badge) {
        badge.classList.toggle("online", conectado);
        badge.classList.toggle("offline", !conectado);
    }
    if (estado) {
        estado.textContent = texto;
    }
}

function aplicarSnapshot(snapshot) {
    if (!snapshot || !snapshot.escritura || !snapshot.tiempo_real) {
        return;
    }

    const timestamp = Date.parse(snapshot.timestamp);
    if (Number.isFinite(timestamp) && timestamp <= ultimoTimestamp) {
        return;
    }
    if (Number.isFinite(timestamp)) {
        ultimoTimestamp = timestamp;
    }

    actualizarMeta(snapshot);
    actualizarTarjetas(snapshot);

    if (pausado) {
        return;
    }

    historial.push(snapshot);
    if (historial.length > MAX_PUNTOS) {
        historial.shift();
    }

    actualizarGrafica();
    actualizarTabla();
    actualizarResumen(snapshot);
}

function actualizarMeta(snapshot) {
    const config = snapshot.config || {};

    const fincas = document.getElementById("meta-fincas");
    if (fincas) {
        fincas.textContent = numero(config.fincas, 0);
    }

    const intervalo = document.getElementById("meta-intervalo");
    if (intervalo) {
        intervalo.textContent = `${numero(config.intervalo_ms, 0)} ms`;
    }

    const uptime = document.getElementById("meta-uptime");
    if (uptime) {
        uptime.textContent = formatearUptime(snapshot.uptime_s);
    }
}

function formatearUptime(segundos) {
    const total = Math.max(0, Math.floor(Number(segundos) || 0));
    if (total < 60) {
        return `${total}s`;
    }
    const minutos = Math.floor(total / 60);
    if (minutos < 60) {
        return `${minutos}m ${total % 60}s`;
    }
    const horas = Math.floor(minutos / 60);
    return `${horas}h ${minutos % 60}m`;
}

function actualizarTarjetas(snapshot) {
    for (const motor of MOTORES) {
        const tarjeta = document.getElementById(`card-${motor}`);
        if (!tarjeta) {
            continue;
        }

        const escritura = snapshot.escritura[motor] || {};
        const tiempoReal = snapshot.tiempo_real[motor] || {};

        asignar(tarjeta, "escritura-p50", numero(escritura.p50_ms));
        asignar(tarjeta, "escritura-media", numero(escritura.media_ms));
        asignar(tarjeta, "escritura-p95", numero(escritura.p95_ms));
        asignar(tarjeta, "escritura-p99", numero(escritura.p99_ms));
        asignar(tarjeta, "e2e-p50", numero(tiempoReal.p50_ms));
        asignar(tarjeta, "e2e-media", numero(tiempoReal.media_ms));
        asignar(tarjeta, "e2e-p95", numero(tiempoReal.p95_ms));
        asignar(tarjeta, "e2e-p99", numero(tiempoReal.p99_ms));

        const throughput = snapshot.throughput_ops_s?.[motor];
        asignar(tarjeta, "throughput", `${numero(throughput, 1)} ops/s`);

        const total = snapshot.total?.[motor];
        asignar(tarjeta, "total", formatoEntero.format(Number(total) || 0));

        const errores = snapshot.errores?.[motor];
        asignar(tarjeta, "errores", formatoEntero.format(Number(errores) || 0));
    }
}

function asignar(tarjeta, campo, valor) {
    const elemento = tarjeta.querySelector(`[data-field="${campo}"]`);
    if (elemento) {
        elemento.textContent = valor;
    }
}

function actualizarGrafica() {
    if (!grafica) {
        return;
    }

    grafica.data.labels = historial.map((snapshot) => formatearHora(snapshot.timestamp));
    grafica.options.scales.y.title.text =
        metrica === "escritura" ? "Escritura (ms)" : "Tiempo real e2e (ms)";

    const series = [];
    for (const motor of MOTORES) {
        const color = COLORES[motor];
        const nombre = NOMBRES[motor];

        series.push({
            label: `${nombre} p50`,
            data: historial.map((snapshot) => snapshot[metrica]?.[motor]?.p50_ms ?? null),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false,
        });

        series.push({
            label: `${nombre} p95`,
            data: historial.map((snapshot) => snapshot[metrica]?.[motor]?.p95_ms ?? null),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25,
            fill: false,
        });
    }

    grafica.data.datasets = series;
    grafica.update("none");
}

function actualizarTabla() {
    const cuerpo = document.getElementById("compare-table-body");
    if (!cuerpo) {
        return;
    }

    const filas = historial.slice(-MAX_TABLA).reverse();
    if (filas.length === 0) {
        cuerpo.innerHTML = '<tr><td colspan="5">Esperando datos…</td></tr>';
        return;
    }

    cuerpo.innerHTML = filas
        .map((snapshot) => {
            const escritura = snapshot.escritura;
            const tiempoReal = snapshot.tiempo_real;

            return `<tr>
                <td>${formatearHora(snapshot.timestamp)}</td>
                <td class="col-postgres">${numero(escritura?.postgres?.p50_ms)}</td>
                <td class="col-redis">${numero(escritura?.redis?.p50_ms)}</td>
                <td class="col-postgres">${numero(tiempoReal?.postgres?.p50_ms)}</td>
                <td class="col-redis">${numero(tiempoReal?.redis?.p50_ms)}</td>
            </tr>`;
        })
        .join("");
}

function actualizarResumen(snapshot) {
    const resumen = document.getElementById("compare-summary");
    if (!resumen) {
        return;
    }

    const postgres = Number(snapshot.escritura?.postgres?.p50_ms);
    const redis = Number(snapshot.escritura?.redis?.p50_ms);

    if (!Number.isFinite(postgres) || !Number.isFinite(redis)) {
        resumen.textContent = "Esperando datos del comparador…";
        return;
    }

    const ganador = redis < postgres ? "Redis" : "PostgreSQL";
    const menor = Math.min(postgres, redis);
    const mayor = Math.max(postgres, redis);
    const factor = menor > 0 ? mayor / menor : 0;

    resumen.innerHTML =
        `Escritura p50: PostgreSQL <strong>${numero(postgres)} ms</strong> · ` +
        `Redis <strong>${numero(redis)} ms</strong>. En esta ventana gana ` +
        `<strong>${ganador}</strong> por <strong>${factor.toFixed(1)}×</strong> ` +
        `en latencia p50 (${historial.length} ciclos graficados).`;
}

document.addEventListener("DOMContentLoaded", iniciar);
