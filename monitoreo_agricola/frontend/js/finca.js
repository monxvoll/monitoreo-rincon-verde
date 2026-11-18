// Página de una finca: todos los datos de sus sensores, qué hacer y lo que ha pasado.
import {
    cargarRangos, config, VARIABLES, NIVELES, finca as datosFinca, tipoDe, reglas,
    franjaIdeal, formatearValor, textoIdeal, peorNivel, clasificar,
} from './rangos.js';
import { estado, suscribir, avisosActivos, iniciar, cambio, tiempoIdeal, eventosFinca } from './store.js';
import {
    iconoTipo, iconoVar, icono, SVG_HECHO, hora, horaCorta, hace, duracion,
    pintar, pintarConexion, enlazarHechos,
} from './comun.js';

const $ = id => document.getElementById(id);
const ID = new URLSearchParams(location.search).get("id");
const LECTURAS_TABLA = 10;
const PUNTOS_MINIGRAFICA = 30;

let variableGrafica = "temperatura";
let grafica = null;

// ---------- Cabecera ----------
function pintarCabecera() {
    const f = estado.fincas[ID];
    $("cabecera").dataset.nivel = f.nivel;
    $("estado").dataset.nivel = f.nivel;
    $("estado").textContent = NIVELES[f.nivel].texto;
    $("actualizado").textContent = f.ultima ? `Actualizado ${hace(f.ultima.timestamp)}` : "Sin datos todavía";
}

// ---------- Qué hacer ahora ----------
function pintarTareas() {
    const avisos = avisosActivos(ID);
    if (!avisos.length) {
        pintar($("tareas"), `
            <div class="tarjeta tarea tranquila">
                ${icono('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>')}
                <div><h3>No hay nada que hacer</h3><p>Todos los datos están en su rango ideal.</p></div>
            </div>`);
        return;
    }
    const urgencia = { actuar: "Urgente", atencion: "Pronto", sin_senal: "Revisar" };
    pintar($("tareas"), avisos.map((a, i) => {
        const principal = i === 0 && !a.hecho;
        if (a.nivel === "sin_senal") {
            return `<article class="tarjeta tarea${principal ? " principal" : ""}">
                <div class="tarea-cabecera"><span class="etiqueta">Sensor</span><span class="pildora" data-nivel="sin_senal">Sin señal</span></div>
                <h3>El sensor no está enviando datos. Revise la conexión o la batería.</h3>
                <div class="tarea-pie"><small>${a.desde ? `Último dato a las ${hora(a.desde)}` : "Todavía no llegan datos"}</small></div>
            </article>`;
        }
        const v = config().variables[a.variable];
        const accion = a.hecho
            ? `<span class="marca-hecho">${icono(SVG_HECHO)}Hecho a las ${hora(a.hecho)}</span>`
            : `<button class="boton acento${principal ? " lleno" : ""}" type="button" data-hecho="${ID}|${a.variable}">Marcar como hecho</button>`;
        return `<article class="tarjeta tarea${principal ? " principal" : ""}${a.hecho ? " hecha" : ""}">
            <div class="tarea-cabecera">
                <span class="etiqueta">${v.corto} · ${a.palabra}</span>
                <span class="pildora" data-nivel="${a.nivel}">${urgencia[a.nivel]}</span>
            </div>
            <h3>${a.consejo}</h3>
            <div class="tarea-pie"><small>Desde las ${hora(a.desde)} (${duracion(a.desde)})</small>${accion}</div>
        </article>`;
    }).join(""));
}

// ---------- Indicadores con minigráfica ----------
function minigrafica(v) {
    const f = estado.fincas[ID];
    const datos = f.lecturas.slice(-PUNTOS_MINIGRAFICA).map(r => r[v]);
    if (datos.length < 2) return "";
    const [imin, imax] = franjaIdeal(ID, v);
    const lo = Math.min(...datos), hi = Math.max(...datos);
    const margen = Math.max((hi - lo) * 0.25, config().variables[v].cambio_minimo * 2);
    const ymin = lo - margen, ymax = hi + margen;
    const W = 120, H = 52;
    const x = i => (i / (datos.length - 1)) * W;
    const y = val => H - ((val - ymin) / (ymax - ymin)) * H;
    const puntos = datos.map((d, i) => `${x(i).toFixed(1)},${y(d).toFixed(1)}`);
    const fTop = Math.max(0, y(Math.min(imax, ymax))), fBot = Math.min(H, y(Math.max(imin, ymin)));
    const franja = fBot > fTop ? `<rect class="franja" x="0" y="${fTop.toFixed(1)}" width="${W}" height="${(fBot - fTop).toFixed(1)}" rx="3"/>` : "";
    return `<svg class="kpi-minigrafica" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${franja}
        <path class="area" d="M0,${H} L${puntos.join(" L")} L${W},${H} Z"/>
        <polyline class="linea" points="${puntos.join(" ")}"/>
        <circle class="punto" cx="${x(datos.length - 1).toFixed(1)}" cy="${y(datos.at(-1)).toFixed(1)}" r="3.5"/>
    </svg>`;
}

function textoCambio(v) {
    const c = cambio(ID, v);
    const u = config().variables[v].unidad;
    if (Math.abs(c.diff) < config().variables[v].cambio_minimo / 2) return { texto: "→ Estable en 1 min", sentido: "igual" };
    const flecha = c.diff > 0 ? "↑" : "↓";
    return { texto: `${flecha} ${formatearValor(v, Math.abs(c.diff))} ${u} en 1 min`, sentido: c.sentido };
}

function pintarKpis() {
    const f = estado.fincas[ID];
    pintar($("kpis"), VARIABLES().map(v => {
        const d = f.vars[v];
        const cfg = config().variables[v];
        if (!d) return `<div class="tarjeta kpi"><div class="kpi-cabecera"><span>${iconoVar(v)}${cfg.nombre}</span></div><div class="kpi-valor">--</div></div>`;
        const nivel = f.nivel === "sin_senal" ? "sin_senal" : d.tramo.nivel;
        const c = textoCambio(v);
        return `<div class="tarjeta kpi" data-nivel="${nivel}">
            <div class="kpi-cabecera">
                <span>${iconoVar(v)}${cfg.nombre}</span>
                <button type="button" data-ver="${v}">Ver gráfica</button>
            </div>
            <div class="kpi-cuerpo">
                <div class="kpi-valor">${formatearValor(v, d.valor)}<small>${cfg.unidad}</small></div>
                ${minigrafica(v)}
            </div>
            <div class="kpi-pie">
                <span class="pildora" data-nivel="${nivel}">${d.tramo.palabra}</span>
                <span class="cambio" data-sentido="${c.sentido}">${c.texto}</span>
            </div>
            <div class="kpi-ideal">Ideal: ${textoIdeal(ID, v)}</div>
        </div>`;
    }).join(""));
}

// ---------- Gráfica de tendencia ----------
const franjaPlugin = {
    id: "franjaIdeal",
    beforeDatasetsDraw(chart, _args, opts) {
        if (!opts || opts.min == null) return;
        const { ctx, chartArea: area, scales: { y } } = chart;
        const top = Math.max(area.top, y.getPixelForValue(opts.max));
        const bottom = Math.min(area.bottom, y.getPixelForValue(opts.min));
        if (bottom <= top) return;
        ctx.save();
        ctx.fillStyle = "rgba(35, 128, 74, 0.12)";
        ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
        ctx.restore();
    },
};

function pintarSelector() {
    $("selector").innerHTML = VARIABLES().map(v =>
        `<button type="button" data-var="${v}" aria-pressed="${v === variableGrafica}">${config().variables[v].corto}</button>`
    ).join("");
}

function crearGrafica() {
    if (typeof Chart === "undefined") {
        $("resumen-tendencia").textContent = "No se pudo cargar la librería de gráficas.";
        return;
    }
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = "#5f676d";
    Chart.defaults.locale = "es-CO";
    grafica = new Chart($("grafica"), {
        type: "line",
        data: { labels: [], datasets: [{
            data: [], borderColor: "#0f5f5a", borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4,
            tension: 0.35, fill: false,
        }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { display: false }, franjaIdeal: {} },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
                y: { grid: { color: "#eef0f3" }, ticks: { maxTicksLimit: 6 } },
            },
        },
        plugins: [franjaPlugin],
    });
}

function pintarGrafica() {
    const f = estado.fincas[ID];
    const v = variableGrafica;
    const cfg = config().variables[v];
    const r = reglas(ID, v);
    if (grafica) {
        const [min, max] = franjaIdeal(ID, v);
        grafica.options.plugins.franjaIdeal = { min, max };
        grafica.options.plugins.tooltip = { callbacks: { label: c => `${formatearValor(v, c.parsed.y)} ${cfg.unidad}` } };
        const datos = f.lecturas.map(l => l[v]);
        const lo = Math.min(min, ...datos), hi = Math.max(max, ...datos);
        const margen = (hi - lo) * 0.15 || 1;
        grafica.options.scales.y.min = Math.max(r.escala[0], Math.floor(lo - margen));
        grafica.options.scales.y.max = Math.min(r.escala[1], Math.ceil(hi + margen));
        grafica.data.labels = f.lecturas.map(l => horaCorta(l.timestamp));
        grafica.data.datasets[0].data = datos;
        grafica.update();
    }

    const d = f.vars[v];
    if (!d || !f.lecturas.length) { $("resumen-tendencia").textContent = "Esperando datos…"; return; }
    const datos = f.lecturas.map(l => l[v]);
    const fmt = n => `${formatearValor(v, n)} ${cfg.unidad}`;
    const minutos = Math.max(1, Math.round((Date.parse(f.lecturas.at(-1).timestamp) - Date.parse(f.lecturas[0].timestamp)) / 60000));
    $("resumen-tendencia").innerHTML =
        `Ahora: <strong>${fmt(d.valor)}</strong> (${d.tramo.palabra.toLowerCase()}). ` +
        `En los últimos ${minutos} min estuvo entre ${fmt(Math.min(...datos))} y ${fmt(Math.max(...datos))}. ` +
        `Lo ideal es ${textoIdeal(ID, v)}.`;
}

function elegirVariable(v) {
    variableGrafica = v;
    pintarSelector();
    pintarGrafica();
}

// ---------- Tablas ----------
function pintarTablaIdeal() {
    const f = estado.fincas[ID];
    $("nota-ideal").textContent = f.primeraLectura
        ? `Desde las ${hora(f.primeraLectura)}, cuando empezó este registro.`
        : "";
    pintar($("tabla-ideal"), VARIABLES().map(v => {
        const d = f.vars[v];
        const cfg = config().variables[v];
        const pct = tiempoIdeal(ID, v);
        const nivelBarra = pct === null ? "bien" : pct >= 80 ? "bien" : pct >= 50 ? "atencion" : "actuar";
        return `<tr>
            <td><strong>${cfg.corto}</strong></td>
            <td>${d ? `<span class="pildora" data-nivel="${d.tramo.nivel}">${d.tramo.palabra}</span>` : ""}</td>
            <td>${textoIdeal(ID, v)}</td>
            <td>${pct === null ? "--" : `<div class="progreso" data-nivel="${nivelBarra}">
                <div class="progreso-barra"><span style="width:${pct}%"></span></div>
                <div class="progreso-texto"><span>${pct >= 80 ? "Muy bien" : pct >= 50 ? "Regular" : "Poco tiempo"}</span><span>${pct}%</span></div>
            </div>`}</td>
        </tr>`;
    }).join(""));
}

function textoEvento(e) {
    const v = config().variables[e.variable];
    if (e.tipo === "hecho") return `<strong>Marcado como hecho</strong> · ${e.texto ?? `tarea de ${v.corto.toLowerCase()}`}`;
    if (e.tipo === "resuelto") return `<strong>${v.corto} volvió a lo normal</strong> (${formatearValor(e.variable, e.valor)} ${v.unidad})`;
    if (e.tipo === "mejora") return `<strong>${v.corto} mejoró: ${e.palabra.toLowerCase()}</strong> (${formatearValor(e.variable, e.valor)} ${v.unidad})`;
    return `<strong>${v.corto}: ${e.palabra.toLowerCase()}</strong> (${formatearValor(e.variable, e.valor)} ${v.unidad})`;
}

function pintarEventos() {
    const f = estado.fincas[ID];
    const eventos = eventosFinca(ID);
    pintar($("eventos"), eventos.length
        ? eventos.map(e => `<li class="evento" data-tipo="${e.tipo}" data-nivel="${e.nivel}">
            <span class="evento-hora">${hora(e.ts)}</span>
            <span class="evento-cuerpo">${textoEvento(e)}</span>
        </li>`).join("")
        : `<li class="vacio">Sin novedades${f.primeraLectura ? ` desde las ${hora(f.primeraLectura)}` : ""}: todo se ha mantenido igual.</li>`);
}

function pintarLecturas() {
    const f = estado.fincas[ID];
    const filas = f.lecturas.slice(-LECTURAS_TABLA).reverse();
    pintar($("tabla-lecturas"), filas.length ? filas.map(r => {
        const niveles = VARIABLES().map(v => clasificar(ID, v, r[v]).nivel);
        const peor = peorNivel(niveles);
        const celdas = VARIABLES().map((v, i) =>
            `<td class="num valor" data-nivel="${niveles[i]}">${formatearValor(v, r[v])} ${config().variables[v].unidad}</td>`).join("");
        return `<tr><td class="num">${horaCorta(r.timestamp)}:${String(new Date(r.timestamp).getSeconds()).padStart(2, "0")}</td>${celdas}
            <td><span class="pildora" data-nivel="${peor}">${NIVELES[peor].texto}</span></td></tr>`;
    }).join("") : `<tr><td colspan="5" class="vacio">Todavía no hay lecturas.</td></tr>`);
}

// ---------- Inicio ----------
function pintarEstatico() {
    const f = datosFinca(ID);
    const tipo = tipoDe(ID);
    document.title = `${f.nombre} — Rincón Verde`;
    $("icono-tipo").innerHTML = iconoTipo(f.tipo);
    $("nombre").textContent = f.nombre;
    $("detalle").textContent = `${tipo.nombre} · ${tipo.lugar} · ${f.detalle}`;
    $("cabecera-lecturas").innerHTML = `<tr><th>Hora</th>${VARIABLES().map(v => `<th>${config().variables[v].corto}</th>`).join("")}<th>Estado</th></tr>`;
    $("titulo-ayuda").textContent = `¿Qué significa cada dato en una finca de ${tipo.corto.toLowerCase()}?`;
    $("ayuda").innerHTML = VARIABLES().map(v => `
        <div><h3>${iconoVar(v)}${config().variables[v].nombre}</h3>
        <p>${reglas(ID, v).ayuda} <strong>Ideal: ${textoIdeal(ID, v)}.</strong></p></div>`).join("");
}

function actualizarTodo() {
    pintarCabecera();
    pintarTareas();
    pintarKpis();
    pintarGrafica();
    pintarTablaIdeal();
    pintarEventos();
    pintarLecturas();
}

function fincaNoEncontrada() {
    $("pagina").innerHTML = `
        <a class="volver" href="index.html">← Todas las fincas</a>
        <section class="tarjeta bloque"><h2>No encontramos esa finca</h2>
        <p class="nota">Vuelva a la lista de fincas y elija una.</p></section>`;
}

async function arrancar() {
    try {
        await cargarRangos();
    } catch (err) {
        $("nombre").textContent = "No se pudo cargar la configuración del panel.";
        console.error(err);
        return;
    }
    if (!ID || !datosFinca(ID)) return fincaNoEncontrada();

    pintarEstatico();
    pintarSelector();
    crearGrafica();
    enlazarHechos($("tareas"));
    $("selector").addEventListener("click", e => {
        const b = e.target.closest("[data-var]");
        if (b) elegirVariable(b.dataset.var);
    });
    $("kpis").addEventListener("click", e => {
        const b = e.target.closest("[data-ver]");
        if (!b) return;
        elegirVariable(b.dataset.ver);
        $("tendencia").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    suscribir(c => {
        if (c.tipo === "conexion") return pintarConexion();
        if (c.tipo === "lectura" && c.finca !== ID) return;
        if (c.tipo === "reloj") {
            pintarCabecera();
            pintarTareas();
            return;
        }
        actualizarTodo();
    });

    await iniciar();
}

document.addEventListener("DOMContentLoaded", arrancar);
