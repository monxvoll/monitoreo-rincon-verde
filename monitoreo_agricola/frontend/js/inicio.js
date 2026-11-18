// Vista de inicio: de un vistazo, qué fincas están bien y cuáles necesitan algo.
// Los números y las recomendaciones están en la página de cada finca.
import { cargarRangos, config, VARIABLES, IDS_FINCAS, NIVELES, nombreFinca, finca as datosFinca } from './rangos.js';
import { estado, suscribir, avisosActivos, iniciar } from './store.js';
import {
    iconoTipo, iconoVar, iconoMensaje, icono, SVG_ESTADO, SVG_CALENDARIO, TEXTO_INDICADOR,
    hace, saludo, fechaLarga, pintar, pintarConexion, htmlAviso, htmlResuelto, enlazarHechos, mensajeFinca,
} from './comun.js';

const $ = id => document.getElementById(id);
const CLAVE_FILTRO = "rincon-verde:filtro";
let filtro = "todas";

const municipio = id => datosFinca(id).detalle.split("·").pop().trim();
const enlace = id => `finca.html?id=${encodeURIComponent(id)}`;

// ---------- Tarjetas ----------
function crearTarjeta(id, indice) {
    const f = datosFinca(id);
    const tipo = config().tipos[f.tipo];
    const el = document.createElement("article");
    el.className = "tarjeta tarjeta-finca";
    el.id = `finca-${id}`;
    el.dataset.nivel = "sin_senal";
    el.dataset.tipo = f.tipo;
    el.dataset.indice = indice;
    el.innerHTML = `
        <div class="tarjeta-finca-titulo">
            <span class="icono-caja">${iconoTipo(f.tipo)}</span>
            <div>
                <h3><a href="${enlace(id)}">${f.nombre}</a></h3>
                <p class="detalle">${tipo.corto} · ${municipio(id)}</p>
            </div>
        </div>
        <div class="mensaje-estado"></div>
        <ul class="indicadores">
            ${VARIABLES().map(v => `
            <li class="indicador" data-var="${v}" data-nivel="sin_senal">
                <span class="indicador-nombre">${iconoVar(v)}${config().variables[v].corto}</span>
                <span class="indicador-estado"><span class="marca-estado"></span><span class="texto"></span></span>
            </li>`).join("")}
        </ul>
        <div class="tarjeta-finca-pie">
            <span class="actualizado">Sin datos</span>
            <a class="boton" href="${enlace(id)}" tabindex="-1">Ver finca</a>
        </div>`;
    return el;
}

function actualizarTarjeta(id) {
    const f = estado.fincas[id];
    const el = $(`finca-${id}`);
    if (!el) return;

    if (el.dataset.nivel !== f.nivel) {
        el.dataset.nivel = f.nivel;
        // Las fincas con problemas suben; solo cambia cuando cambia el estado, no con cada lectura
        el.style.order = NIVELES[f.nivel].orden * 10 + Number(el.dataset.indice);
        const boton = el.querySelector(".boton");
        const urgente = f.nivel === "actuar";
        boton.className = urgente ? "boton acento lleno" : "boton";
        boton.textContent = urgente ? "Ver qué hacer" : "Ver finca";
    }

    pintar(el.querySelector(".mensaje-estado"), `${iconoMensaje(f.nivel)}<span>${mensajeFinca(f)}</span>`);

    for (const v of VARIABLES()) {
        const fila = el.querySelector(`[data-var="${v}"]`);
        const nivel = f.nivel === "sin_senal" ? "sin_senal" : (f.vars[v]?.tramo.nivel ?? "sin_senal");
        if (fila.dataset.nivel === nivel && fila.querySelector(".texto").textContent) continue;
        fila.dataset.nivel = nivel;
        fila.querySelector(".marca-estado").innerHTML = icono(SVG_ESTADO[nivel]);
        fila.querySelector(".texto").textContent = TEXTO_INDICADOR[nivel];
    }

    el.querySelector(".actualizado").textContent = f.ultima ? `Actualizado ${hace(f.ultima.timestamp)}` : "Sin datos";
}

// ---------- Saludo y conteos ----------
function listaNombres(ids) {
    const n = ids.map(id => `<strong>${nombreFinca(id)}</strong>`);
    return n.length > 1 ? `${n.slice(0, -1).join(", ")} y ${n.at(-1)}` : n[0];
}

function actualizarResumen() {
    const fincas = Object.values(estado.fincas);
    const por = n => fincas.filter(f => f.nivel === n).map(f => f.id);
    const grupos = { bien: por("bien"), atencion: por("atencion"), actuar: por("actuar"), sin_senal: por("sin_senal") };
    const total = fincas.length;

    let texto = grupos.bien.length === total
        ? `Hoy <strong>todas sus fincas están bien</strong>. No necesita hacer nada por ahora.`
        : `Hoy <strong>${grupos.bien.length} de ${total} fincas</strong> están bien.`;
    if (grupos.actuar.length) {
        texto += ` ${listaNombres(grupos.actuar)} ${grupos.actuar.length === 1 ? "necesita" : "necesitan"} que actúe ahora.`;
    } else if (grupos.atencion.length) {
        texto += ` Revise pronto ${listaNombres(grupos.atencion)}.`;
    }
    if (grupos.sin_senal.length) {
        texto += ` ${listaNombres(grupos.sin_senal)} no ${grupos.sin_senal.length === 1 ? "envía" : "envían"} datos.`;
    }
    pintar($("saludo-resumen"), texto);

    const tarjetas = [
        ["bien", "Están bien", "No necesitan nada"],
        ["atencion", "Para revisar", "Algo se sale de lo normal"],
        ["actuar", "Actuar ahora", "Necesitan acción ya"],
        ["sin_senal", "Sin señal", "El sensor no envía datos"],
    ];
    pintar($("conteos"), tarjetas.map(([n, titulo, sub]) => `
        <div class="tarjeta conteo" data-nivel="${n}" data-activo="${grupos[n].length ? "si" : "no"}">
            <div class="conteo-cabecera">${titulo}</div>
            <div class="conteo-numero">${grupos[n].length} <small>de ${total}</small></div>
            <div class="conteo-texto">${sub}</div>
        </div>`).join(""));
}

// ---------- Avisos ----------
function actualizarAvisos() {
    const activos = avisosActivos();
    pintar($("avisos-activos"), activos.length
        ? activos.map(a => htmlAviso(a)).join("")
        : `<li class="vacio">No hay avisos. Todo está en orden.</li>`);
    pintar($("avisos-resueltos"), estado.resueltos.length
        ? estado.resueltos.map(htmlResuelto).join("")
        : `<li class="vacio">Nada por ahora.</li>`);
    pintar($("resumen-resueltos"), `Resueltos hace poco (${estado.resueltos.length})`);
}

// ---------- Filtro por tipo ----------
function pintarFiltros() {
    const conteo = t => IDS_FINCAS().filter(id => t === "todas" || datosFinca(id).tipo === t).length;
    const opciones = [["todas", "Todas", null], ...Object.entries(config().tipos).map(([k, t]) => [k, t.corto, k])];
    $("filtros").innerHTML = opciones.map(([k, nombre, tipo]) => `
        <button class="chip-filtro" type="button" data-filtro="${k}" aria-pressed="${k === filtro}">
            ${tipo ? iconoTipo(tipo) : ""}${nombre} <span>${conteo(k)}</span>
        </button>`).join("");
    document.querySelectorAll(".tarjeta-finca").forEach(el => {
        el.classList.toggle("oculto", filtro !== "todas" && el.dataset.tipo !== filtro);
    });
}

function enlazarFiltros() {
    try { filtro = localStorage.getItem(CLAVE_FILTRO) ?? "todas"; } catch { /* sin almacenamiento */ }
    if (filtro !== "todas" && !config().tipos[filtro]) filtro = "todas";
    $("filtros").addEventListener("click", e => {
        const b = e.target.closest("[data-filtro]");
        if (!b) return;
        filtro = b.dataset.filtro;
        try { localStorage.setItem(CLAVE_FILTRO, filtro); } catch { /* sin almacenamiento */ }
        pintarFiltros();
    });
}

// ---------- Inicio ----------
function actualizarTodo() {
    IDS_FINCAS().forEach(actualizarTarjeta);
    actualizarResumen();
    actualizarAvisos();
}

async function arrancar() {
    $("saludo").textContent = saludo();
    $("fecha").innerHTML = `${icono(SVG_CALENDARIO)}<span>${fechaLarga()}</span>`;
    try {
        await cargarRangos();
    } catch (err) {
        $("saludo-resumen").textContent = "No se pudo cargar la configuración del panel.";
        console.error(err);
        return;
    }

    const contenedor = $("fincas");
    IDS_FINCAS().forEach((id, i) => contenedor.appendChild(crearTarjeta(id, i)));
    enlazarFiltros();
    pintarFiltros();
    enlazarHechos($("avisos-activos"));

    suscribir(cambio => {
        if (cambio.tipo === "conexion") return pintarConexion();
        if (cambio.tipo === "lectura") {
            actualizarTarjeta(cambio.finca);
            actualizarResumen();
            actualizarAvisos();
            return;
        }
        actualizarTodo(); // inicio, reloj y tareas marcadas como hechas
    });

    await iniciar();
}

document.addEventListener("DOMContentLoaded", arrancar);
