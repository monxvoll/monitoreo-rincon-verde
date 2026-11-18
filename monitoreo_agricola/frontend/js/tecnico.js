// Vista técnica: métricas de Redis, claves, mensajes Pub/Sub en vivo y datos crudos.
import { API_BASE, WS_URL, MAX_HISTORIAL } from './config.js';
import {
    cargarRangos, config, VARIABLES, IDS_FINCAS, NIVELES, nombreFinca, finca as datosFinca,
    clasificar, peorNivel, umbralSuperior, franjaIdeal, formatearValor,
} from './rangos.js';
import { iconoTipo, horaCorta, pintar } from './comun.js';

// Hora con segundos en formato 24 h (más compacta para tablas y consola)
const hms = iso => new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const $ = id => document.getElementById(id);
const COLORES = ["#0f5f5a", "#e5853a", "#3b6fd4", "#8e5bd0", "#b5446e", "#6b7a2a"];
const MAX_CONSOLA = 60;
const VENTANA_TASA_MS = 10000;
const INTERVALO_REDIS_MS = 3000;

const historial = {};   // finca -> lecturas en orden cronologico
const ultima = {};      // finca -> ultima lectura
const llegadas = [];    // momentos de llegada de mensajes (para mensajes por segundo)
let infoRedis = null;
let latenciaApi = null;
let conexion = "conectando";
let pausado = false;
let variable = "temperatura";
let fincaGrafica = "todas";
let fincaHistorial = null;
let grafica = null;

const color = id => COLORES[IDS_FINCAS().indexOf(id) % COLORES.length];
const unidad = v => config().variables[v].unidad;
const nivelDe = (reg, v) => reg.niveles?.[v] ?? clasificar(reg.finca_id, v, reg[v]).nivel;

// ---------- Métricas ----------
function mensajesPorSegundo() {
    const limite = Date.now() - VENTANA_TASA_MS;
    while (llegadas.length && llegadas[0] < limite) llegadas.shift();
    return llegadas.length / (VENTANA_TASA_MS / 1000);
}

function tiempoActivo(s) {
    if (s == null) return "--";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
}

function pintarMetricas() {
    const r = infoRedis ?? {};
    const n = v => (v ?? "--").toLocaleString?.("es-CO") ?? v;
    const tarjetas = [
        ["Mensajes Pub/Sub", mensajesPorSegundo().toLocaleString("es-CO", { maximumFractionDigits: 1 }), "/s", "Promedio de los últimos 10 s"],
        ["Latencia de la API", latenciaApi == null ? "--" : Math.round(latenciaApi), "ms", "Ida y vuelta de GET /api/redis"],
        ["PING a Redis", r.latencia_ping_ms == null ? "--" : r.latencia_ping_ms.toLocaleString("es-CO"), "ms", "Medido desde FastAPI"],
        ["Claves", n(r.claves_totales), "", "2 por finca: String + List"],
        ["Memoria usada", r.memoria_usada ?? "--", "", "used_memory de Redis"],
        ["Operaciones", n(r.operaciones_por_segundo), "/s", "instantaneous_ops_per_sec"],
        ["Clientes conectados", n(r.clientes_conectados), "", `${n(r.suscriptores_canal)} suscritos al canal`],
        ["Comandos procesados", n(r.comandos_procesados), "", `Redis activo hace ${tiempoActivo(r.segundos_activo)}`],
    ];
    pintar($("metricas"), tarjetas.map(([t, v, u, s]) => `
        <div class="tarjeta metrica">
            <div class="metrica-titulo">${t}</div>
            <div class="metrica-valor">${v}${u ? `<small>${u}</small>` : ""}</div>
            <div class="metrica-sub">${s}</div>
        </div>`).join(""));
}

async function consultarRedis() {
    try {
        const inicio = performance.now();
        const res = await fetch(`${API_BASE}/api/redis`, { cache: "no-store" });
        latenciaApi = performance.now() - inicio;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        infoRedis = await res.json();
        $("version-redis").textContent = `Redis ${infoRedis.version}`;
        pintarClaves();
    } catch (err) {
        console.error("No se pudo consultar /api/redis:", err);
    }
    pintarMetricas();
}

// ---------- Claves ----------
function pintarClaves() {
    if (!infoRedis) return;
    $("nota-claves").textContent = `${infoRedis.claves_totales} claves · ${infoRedis.memoria_usada} de memoria · se actualiza cada 3 s`;
    const escrito = { string: "<code>SET</code>", list: "<code>LPUSH</code> + <code>LTRIM</code>" };
    const filas = infoRedis.claves.map(c => `<tr>
        <td><code>${c.clave}</code></td>
        <td><span class="tipo-clave" data-tipo="${c.tipo}">${c.tipo === "list" ? "List" : "String"}</span></td>
        <td class="num">${c.tamano.toLocaleString("es-CO")} ${c.unidad}</td>
        <td>${escrito[c.tipo]}</td>
    </tr>`);
    filas.push(`<tr>
        <td><code>${infoRedis.canal}</code></td>
        <td><span class="tipo-clave" data-tipo="channel">Canal</span></td>
        <td class="num">${infoRedis.suscriptores_canal} suscriptor${infoRedis.suscriptores_canal === 1 ? "" : "es"}</td>
        <td><code>PUBLISH</code></td>
    </tr>`);
    pintar($("tabla-claves"), filas.join(""));
}

// ---------- Estado actual ----------
function celdaValor(reg, v) {
    return `<td class="num valor" data-nivel="${nivelDe(reg, v)}">${formatearValor(v, reg[v])} ${unidad(v)}</td>`;
}

function pintarEstado() {
    pintar($("tabla-estado"), IDS_FINCAS().map(id => {
        const reg = ultima[id];
        const tipo = config().tipos[datosFinca(id).tipo];
        const cabeza = `<td><span class="tipo-finca">${iconoTipo(datosFinca(id).tipo)}<span><strong>${nombreFinca(id)}</strong><br><small>${tipo.corto} · <code>${id}</code></small></span></span></td>`;
        if (!reg) return `<tr>${cabeza}<td colspan="${VARIABLES().length + 2}" class="vacio">Sin datos</td></tr>`;
        return `<tr>${cabeza}${VARIABLES().map(v => celdaValor(reg, v)).join("")}
            <td class="${reg.alerta ? "alerta-si" : "alerta-no"}">${reg.alerta ? "Sí" : "No"}</td>
            <td class="num">${hms(reg.timestamp)}</td></tr>`;
    }).join(""));
}

// ---------- Consola de mensajes ----------
function lineaConsola(reg) {
    const corto = { temperatura: "temp", humedad: "hum", co2: "co2" };
    const valores = VARIABLES().map(v => `${corto[v] ?? v}=<span class="c-num">${reg[v]}</span>`).join(" ");
    const alerta = reg.alerta ? `<span class="c-alerta">alerta=true</span>` : `<span class="c-ok">alerta=false</span>`;
    return `<li class="nuevo"><span class="c-hora">${hms(reg.timestamp)}</span> <span class="c-finca">${reg.finca_id}</span> ${valores} ${alerta}</li>`;
}

function agregarConsola(reg) {
    if (pausado) return;
    const consola = $("consola");
    consola.insertAdjacentHTML("afterbegin", lineaConsola(reg));
    while (consola.children.length > MAX_CONSOLA) consola.lastElementChild.remove();
}

// ---------- Gráfica comparativa ----------
const franjaPlugin = {
    id: "franjaIdeal",
    beforeDatasetsDraw(chart, _args, opts) {
        if (!opts || opts.min == null) return;
        const { ctx, chartArea: area, scales: { y } } = chart;
        const top = Math.max(area.top, y.getPixelForValue(opts.max));
        const bottom = Math.min(area.bottom, y.getPixelForValue(opts.min));
        if (bottom <= top) return;
        ctx.save();
        ctx.fillStyle = "rgba(35, 128, 74, 0.10)";
        ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
        ctx.restore();
    },
};

function crearGrafica() {
    if (typeof Chart === "undefined") {
        $("resumen-comparacion").textContent = "No se pudo cargar la librería de gráficas.";
        return;
    }
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = "#5f676d";
    Chart.defaults.locale = "es-CO";
    grafica = new Chart($("grafica-comparacion"), {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0.3, borderWidth: 2 } },
            plugins: {
                legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
                franjaIdeal: {},
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                y: { grid: { color: "#eef0f3" }, title: { display: true, text: "" } },
            },
        },
        plugins: [franjaPlugin],
    });
}

function pintarGrafica() {
    const fincas = fincaGrafica === "todas" ? IDS_FINCAS() : [fincaGrafica];
    if (grafica) {
        // El eje X toma la serie mas larga; las demas se alinean por el final
        const base = fincas.map(f => historial[f]).reduce((a, b) => (b.length > a.length ? b : a), []);
        grafica.data.labels = base.map(r => horaCorta(r.timestamp));
        grafica.data.datasets = fincas.map(f => {
            const serie = historial[f].map(r => r[variable]);
            return {
                label: nombreFinca(f),
                data: [...Array(Math.max(0, base.length - serie.length)).fill(null), ...serie],
                borderColor: color(f), backgroundColor: color(f), spanGaps: true,
            };
        });
        const limite = fincaGrafica !== "todas" ? umbralSuperior(fincaGrafica, variable) : null;
        if (limite !== null) {
            grafica.data.datasets.push({
                label: `Límite de alerta (${formatearValor(variable, limite)} ${unidad(variable)})`,
                data: base.map(() => limite),
                borderColor: "#c0392b", backgroundColor: "#c0392b",
                borderDash: [6, 6], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0,
            });
        }
        const [min, max] = fincaGrafica !== "todas" ? franjaIdeal(fincaGrafica, variable) : [null, null];
        grafica.options.plugins.franjaIdeal = { min, max };
        grafica.options.scales.y.title.text = `${config().variables[variable].nombre} (${unidad(variable)})`;
        grafica.update();
    }
    pintarResumen(fincas);
}

function pintarResumen(fincas) {
    const ultimos = fincas.filter(f => ultima[f]).map(f => ({ f, v: ultima[f][variable] }));
    if (!ultimos.length) { $("resumen-comparacion").textContent = "Esperando datos…"; return; }
    const fmt = v => `${formatearValor(variable, v)} ${unidad(variable)}`;
    const prom = ultimos.reduce((s, u) => s + u.v, 0) / ultimos.length;
    const max = ultimos.reduce((a, b) => (b.v > a.v ? b : a));
    const min = ultimos.reduce((a, b) => (b.v < a.v ? b : a));
    const fuera = ultimos.filter(u => clasificar(u.f, variable, u.v).nivel !== "bien");

    let texto = ultimos.length > 1
        ? `Promedio actual: <strong>${fmt(prom)}</strong>. Más alto: <strong>${nombreFinca(max.f)}</strong> (${fmt(max.v)}). Más bajo: <strong>${nombreFinca(min.f)}</strong> (${fmt(min.v)}). `
        : `Valor actual: <strong>${fmt(prom)}</strong>. `;
    texto += fuera.length
        ? `${fuera.length} fuera de su rango ideal: ${fuera.map(u => `${nombreFinca(u.f)} (${clasificar(u.f, variable, u.v).palabra.toLowerCase()})`).join(", ")}.`
        : "Todas dentro de su rango ideal (cada tipo de finca tiene el suyo).";
    pintar($("resumen-comparacion"), texto);
}

function pintarControles() {
    $("selector-variable").innerHTML = VARIABLES().map(v =>
        `<button type="button" data-var="${v}" aria-pressed="${v === variable}">${config().variables[v].corto}</button>`).join("");
    const opciones = IDS_FINCAS().map(id => `<option value="${id}">${nombreFinca(id)}</option>`).join("");
    $("selector-finca").innerHTML = `<option value="todas">Todas las fincas</option>${opciones}`;
    $("selector-historial").innerHTML = opciones;
}

// ---------- Historial de una finca ----------
function pintarHistorial() {
    const id = fincaHistorial;
    $("clave-historial").textContent = `${id}:historial`;
    const filas = [...historial[id]].reverse();
    pintar($("tabla-historial"), filas.length ? filas.map((r, i) => {
        const peor = peorNivel(VARIABLES().map(v => nivelDe(r, v)));
        return `<tr><td class="num">${i}</td><td class="num">${hms(r.timestamp)}</td>
            ${VARIABLES().map(v => celdaValor(r, v)).join("")}
            <td><span class="pildora" data-nivel="${peor}">${NIVELES[peor].texto}</span></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="vacio">La lista está vacía.</td></tr>`);
}

// ---------- Datos ----------
async function cargarHistorial(id) {
    try {
        const res = await fetch(`${API_BASE}/api/historial/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        historial[id] = [...data.historial].reverse();
        ultima[id] = historial[id].at(-1) ?? null;
    } catch (err) {
        console.error(`Error cargando historial de ${id}:`, err);
    }
}

function pintarConexion() {
    const textos = { conectando: "Conectando…", en_vivo: "En vivo", reconectando: "Sin conexión, reintentando…" };
    $("conexion").dataset.estado = conexion;
    $("conexion-texto").textContent = textos[conexion];
}

function conectar() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => { conexion = "en_vivo"; pintarConexion(); };
    ws.onmessage = e => {
        const reg = JSON.parse(e.data);
        if (!historial[reg.finca_id]) return;
        llegadas.push(Date.now());
        historial[reg.finca_id].push(reg);
        if (historial[reg.finca_id].length > MAX_HISTORIAL) historial[reg.finca_id].shift();
        ultima[reg.finca_id] = reg;
        agregarConsola(reg);
        pintarEstado();
        if (fincaGrafica === "todas" || fincaGrafica === reg.finca_id) pintarGrafica();
        if (fincaHistorial === reg.finca_id) pintarHistorial();
    };
    ws.onclose = () => { conexion = "reconectando"; pintarConexion(); setTimeout(conectar, 3000); };
    ws.onerror = err => console.error("WebSocket:", err);
}

// ---------- Inicio ----------
async function arrancar() {
    try {
        await cargarRangos();
    } catch (err) {
        console.error(err);
        return;
    }
    IDS_FINCAS().forEach(id => { historial[id] = []; ultima[id] = null; });
    fincaHistorial = IDS_FINCAS()[0];

    const cabeceraVars = VARIABLES().map(v => `<th>${config().variables[v].corto}</th>`).join("");
    $("cabecera-estado").innerHTML = `<tr><th>Finca</th>${cabeceraVars}<th>Alerta</th><th>Hora</th></tr>`;
    $("cabecera-historial").innerHTML = `<tr><th>Índice</th><th>Hora</th>${cabeceraVars}<th>Estado</th></tr>`;

    pintarControles();
    crearGrafica();
    pintarMetricas();

    $("selector-variable").addEventListener("click", e => {
        const b = e.target.closest("[data-var]");
        if (!b) return;
        variable = b.dataset.var;
        pintarControles();
        $("selector-finca").value = fincaGrafica;
        $("selector-historial").value = fincaHistorial;
        pintarGrafica();
    });
    $("selector-finca").addEventListener("change", e => { fincaGrafica = e.target.value; pintarGrafica(); });
    $("selector-historial").addEventListener("change", e => { fincaHistorial = e.target.value; pintarHistorial(); });
    $("pausar").addEventListener("click", e => {
        pausado = !pausado;
        e.currentTarget.setAttribute("aria-pressed", String(pausado));
        e.currentTarget.textContent = pausado ? "Reanudar" : "Pausar";
    });

    await Promise.all(IDS_FINCAS().map(cargarHistorial));
    pintarEstado();
    pintarGrafica();
    pintarHistorial();
    conectar();

    consultarRedis();
    setInterval(consultarRedis, INTERVALO_REDIS_MS);
    setInterval(pintarMetricas, 1000);
}

document.addEventListener("DOMContentLoaded", arrancar);
