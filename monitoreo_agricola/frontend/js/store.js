// Almacen de datos de las vistas del granjero: historial inicial por REST, novedades por WebSocket,
// y a partir de eso el estado de cada finca, sus tendencias, el tiempo en lo ideal,
// lo que ha pasado durante el dia y las tareas marcadas como hechas.
import { API_BASE, WS_URL, MAX_HISTORIAL } from './config.js';
import { config, VARIABLES, IDS_FINCAS, clasificar, peorNivel, franjaIdeal, reglas } from './rangos.js';

const MAX_RESUELTOS = 6;
const MAX_EVENTOS = 40;
const LECTURAS_TENDENCIA = 6;  // ~30 s atras con una lectura cada 5 s
const LECTURAS_CAMBIO = 12;    // ~1 min atras, para la pildora de cambio
const CLAVE_HECHOS = "rincon-verde:hechos";

export const estado = {
    conexion: "conectando", // conectando | en_vivo | reconectando
    fincas: {},             // id -> ver fincaVacia()
    resueltos: [],          // avisos que ya volvieron a la normalidad
};

const oyentes = new Set();
export const suscribir = fn => { oyentes.add(fn); return () => oyentes.delete(fn); };
const avisar = cambio => oyentes.forEach(fn => fn(cambio));

function fincaVacia(id) {
    return {
        id,
        lecturas: [],     // ultimas MAX_HISTORIAL lecturas, en orden cronologico
        ultima: null,
        ultimaMs: 0,
        vars: {},         // variable -> { valor, tramo, peor, desde, tendencia }
        nivel: "sin_senal",
        ideal: {},        // variable -> { total, bien } desde que se abrio el panel
        primeraLectura: null,
        eventos: [],      // lo que ha pasado, del mas reciente al mas antiguo
    };
}

// ---------- Tareas marcadas como hechas (se guardan en este navegador) ----------
function leerHechos() {
    try { return JSON.parse(localStorage.getItem(CLAVE_HECHOS)) ?? {}; } catch { return {}; }
}
function guardarHechos(hechos) {
    try { localStorage.setItem(CLAVE_HECHOS, JSON.stringify(hechos)); } catch { /* sin almacenamiento */ }
}

/** Hora (ISO) en que se marco como hecho el aviso actual de esa variable, o null. */
export function horaHecho(fincaId, variable) {
    const d = estado.fincas[fincaId]?.vars[variable];
    const marca = leerHechos()[`${fincaId}|${variable}`];
    if (!d || !marca || d.tramo.nivel === "bien") return null;
    // Solo cuenta si se marco despues de que empezo este problema
    return Date.parse(marca) >= Date.parse(d.desde) ? marca : null;
}

export function marcarHecho(fincaId, variable) {
    const hechos = leerHechos();
    const ahora = new Date().toISOString();
    hechos[`${fincaId}|${variable}`] = ahora;
    guardarHechos(hechos);
    const d = estado.fincas[fincaId].vars[variable];
    agregarEvento(estado.fincas[fincaId], { ts: ahora, tipo: "hecho", variable, nivel: "bien", texto: d.tramo.consejo });
    avisar({ tipo: "hecho", finca: fincaId });
}

// ---------- Calculos ----------
function tendencia(lecturas, variable) {
    if (lecturas.length < 3) return "estable";
    const actual = lecturas[lecturas.length - 1][variable];
    const antes = lecturas[Math.max(0, lecturas.length - 1 - LECTURAS_TENDENCIA)][variable];
    const diff = actual - antes;
    if (Math.abs(diff) < config().variables[variable].cambio_minimo) return "estable";
    return diff > 0 ? "sube" : "baja";
}

/** Distancia de un valor a la franja ideal (0 si esta dentro). */
function distanciaIdeal(fincaId, variable, valor) {
    const [min, max] = franjaIdeal(fincaId, variable);
    return valor < min ? min - valor : valor > max ? valor - max : 0;
}

/**
 * Cambio en el ultimo minuto y si es para bien o para mal:
 * es "mejor" si el valor se acerco al rango ideal y "peor" si se alejo.
 */
export function cambio(fincaId, variable) {
    const l = estado.fincas[fincaId].lecturas;
    if (l.length < 2) return { diff: 0, sentido: "igual" };
    const actual = l[l.length - 1][variable];
    const antes = l[Math.max(0, l.length - 1 - LECTURAS_CAMBIO)][variable];
    const diff = actual - antes;
    const dAntes = distanciaIdeal(fincaId, variable, antes);
    const dAhora = distanciaIdeal(fincaId, variable, actual);
    const minimo = config().variables[variable].cambio_minimo / 2;
    let sentido = "igual";
    if (dAhora < dAntes - minimo) sentido = "mejor";
    else if (dAhora > dAntes + minimo) sentido = "peor";
    return { diff, sentido };
}

/** Porcentaje del tiempo que la variable ha estado en el rango ideal. */
export function tiempoIdeal(fincaId, variable) {
    const c = estado.fincas[fincaId].ideal[variable];
    return c && c.total ? Math.round((c.bien / c.total) * 100) : null;
}

function sinSenal(finca, ahora = Date.now()) {
    return !finca.ultima || ahora - finca.ultimaMs > config().segundos_sin_senal * 1000;
}

function calcularNivel(finca) {
    if (sinSenal(finca)) return "sin_senal";
    return peorNivel(Object.values(finca.vars).map(v => v.tramo.nivel));
}

function agregarEvento(finca, evento) {
    finca.eventos.unshift(evento);
    finca.eventos.length = Math.min(finca.eventos.length, MAX_EVENTOS);
}

/** Procesa una lectura: actualiza la finca, sus variables, el registro de avisos y los eventos. */
function procesar(reg) {
    const finca = estado.fincas[reg.finca_id];
    if (!finca) return;

    finca.lecturas.push(reg);
    if (finca.lecturas.length > MAX_HISTORIAL) finca.lecturas.shift();
    finca.ultima = reg;
    finca.ultimaMs = Date.parse(reg.timestamp);
    finca.primeraLectura ??= reg.timestamp;

    for (const v of VARIABLES()) {
        const tramo = clasificar(finca.id, v, reg[v]);
        const previo = finca.vars[v];
        const nivelAntes = previo?.tramo.nivel ?? "bien";
        const habiaProblema = nivelAntes !== "bien";
        const hayProblema = tramo.nivel !== "bien";

        // Tiempo en rango ideal
        const c = (finca.ideal[v] ??= { total: 0, bien: 0 });
        c.total += 1;
        if (!hayProblema) c.bien += 1;

        // Lo que ha pasado: cada cambio de nivel queda registrado
        if (previo && nivelAntes !== tramo.nivel) {
            const tipo = !hayProblema ? "resuelto"
                : habiaProblema && tramo.nivel === "atencion" ? "mejora" : "problema";
            agregarEvento(finca, { ts: reg.timestamp, tipo, variable: v, nivel: tramo.nivel,
                palabra: tramo.palabra, valor: reg[v] });
        }

        // Un problema que se resuelve pasa a la lista de resueltos
        if (habiaProblema && !hayProblema) {
            estado.resueltos.unshift({
                finca: finca.id, variable: v, palabra: previo.peor.palabra,
                nivel: previo.peor.nivel, desde: previo.desde, hasta: reg.timestamp,
            });
            estado.resueltos.length = Math.min(estado.resueltos.length, MAX_RESUELTOS);
        }

        // "desde" marca el inicio de la racha actual fuera de lo normal
        const continua = habiaProblema && hayProblema;
        const peor = continua && previo.peor.nivel === "actuar" ? previo.peor : tramo;
        finca.vars[v] = {
            valor: reg[v],
            tramo,
            peor,
            desde: continua ? previo.desde : reg.timestamp,
            tendencia: tendencia(finca.lecturas, v),
        };
    }
    finca.nivel = calcularNivel(finca);
}

/** Avisos activos: cada variable fuera de "bien" y cada finca sin señal. Los atendidos van al final. */
export function avisosActivos(soloFinca = null) {
    const avisos = [];
    for (const finca of Object.values(estado.fincas)) {
        if (soloFinca && finca.id !== soloFinca) continue;
        if (sinSenal(finca)) {
            avisos.push({ finca: finca.id, variable: null, nivel: "sin_senal", desde: finca.ultima?.timestamp ?? null, hecho: null });
            continue;
        }
        for (const [v, d] of Object.entries(finca.vars)) {
            if (d.tramo.nivel !== "bien") {
                avisos.push({ finca: finca.id, variable: v, nivel: d.tramo.nivel, palabra: d.tramo.palabra,
                    consejo: d.tramo.consejo, valor: d.valor, desde: d.desde, hecho: horaHecho(finca.id, v) });
            }
        }
    }
    const orden = { actuar: 0, sin_senal: 1, atencion: 2 };
    return avisos.sort((a, b) =>
        (a.hecho ? 1 : 0) - (b.hecho ? 1 : 0) ||
        orden[a.nivel] - orden[b.nivel] ||
        String(a.desde).localeCompare(String(b.desde)));
}

/** Eventos de una finca, incluyendo las tareas marcadas como hechas en este navegador. */
export function eventosFinca(fincaId) {
    const finca = estado.fincas[fincaId];
    const desde = finca.primeraLectura ? Date.parse(finca.primeraLectura) : 0;
    const marcados = new Set(finca.eventos.filter(e => e.tipo === "hecho").map(e => `${e.variable}|${e.ts}`));
    const guardados = Object.entries(leerHechos())
        .filter(([k, ts]) => k.startsWith(`${fincaId}|`) && Date.parse(ts) >= desde)
        .map(([k, ts]) => ({ ts, tipo: "hecho", variable: k.split("|")[1], nivel: "bien" }))
        .filter(e => !marcados.has(`${e.variable}|${e.ts}`));
    return [...finca.eventos, ...guardados].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

async function cargarHistorial(id) {
    try {
        const res = await fetch(`${API_BASE}/api/historial/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Redis devuelve del mas reciente al mas antiguo; se procesa en orden cronologico
        [...data.historial].reverse().forEach(procesar);
    } catch (err) {
        console.error(`Error cargando historial de ${id}:`, err);
    }
}

function conectar() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => { estado.conexion = "en_vivo"; avisar({ tipo: "conexion" }); };
    ws.onmessage = e => {
        const reg = JSON.parse(e.data);
        procesar(reg);
        avisar({ tipo: "lectura", finca: reg.finca_id });
    };
    ws.onclose = () => {
        estado.conexion = "reconectando";
        avisar({ tipo: "conexion" });
        setTimeout(conectar, 3000);
    };
    ws.onerror = err => console.error("WebSocket:", err);
}

export async function iniciar() {
    IDS_FINCAS().forEach(id => { estado.fincas[id] = fincaVacia(id); });
    await Promise.all(IDS_FINCAS().map(cargarHistorial));
    avisar({ tipo: "inicio" });
    conectar();

    // Cada segundo: refrescar los "hace X s" y detectar fincas que dejaron de enviar datos
    setInterval(() => {
        for (const finca of Object.values(estado.fincas)) finca.nivel = calcularNivel(finca);
        avisar({ tipo: "reloj" });
    }, 1000);
}

export { reglas };
