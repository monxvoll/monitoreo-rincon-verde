// Piezas compartidas por la vista de inicio y la página de cada finca.
import { config, nombreFinca, NIVELES, formatearValor } from './rangos.js';
import { estado, marcarHecho } from './store.js';

// ---------- Íconos ----------
const SVG_TIPO = {
    ganaderia: '<path d="M7 8.5C5 8.6 3.2 7.6 2.5 5.5c1.8-.2 3.4.3 4.7 1.2"/><path d="M17 8.5c2-.1 3.8-1.1 4.5-3-1.8-.2-3.4.3-4.7 1.2"/><path d="M7 7h10v6.5a5 5 0 0 1-10 0z"/><path d="M8.6 17c.4 2 1.8 3.5 3.4 3.5s3-1.5 3.4-3.5"/><path d="M10.3 18.2h.01M13.7 18.2h.01M10 10.5h.01M14 10.5h.01"/>',
    papa: '<path d="M6.3 7.2C8.8 3.9 15.6 3.4 18.4 6.8s1.4 10.7-4.1 12.4C8.6 20.9 3.6 17.6 4 13.2c.2-2.3 1-4.1 2.3-6z"/><path d="M9 10h.01M14.5 8.5h.01M15.2 14.2h.01M10.3 15.5h.01"/>',
    tomate: '<circle cx="12" cy="14" r="7"/><path d="M12 7V3.5"/><path d="M8.2 7.2 12 9l3.8-1.8"/><path d="M12 9c-.6-1.5-1.8-2.4-3.5-2.5M12 9c.6-1.5 1.8-2.4 3.5-2.5"/>',
};
const SVG_VAR = {
    temperatura: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    humedad: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
    co2: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
};
export const SVG_ESTADO = {
    bien: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    atencion: '<path d="M12 7v6M12 17h.01"/>',
    actuar: '<path d="M12 6v7M12 17h.01"/><path d="M8 3.5h8"/>',
    sin_senal: '<path d="M5 12h14"/>',
};
const SVG_MENSAJE = {
    bien: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    atencion: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
    actuar: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    sin_senal: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01"/><path d="M3 3l18 18"/>',
};
export const SVG_HECHO = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
export const SVG_CALENDARIO = '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>';

export const iconoTipo = (tipo, clase = "icono-tipo") =>
    `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true">${SVG_TIPO[tipo] ?? ""}</svg>`;
export const iconoVar = v => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG_VAR[v] ?? ""}</svg>`;
export const iconoMensaje = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG_MENSAJE[n]}</svg>`;
export const icono = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

// ---------- Tiempo ----------
export function hora(iso) {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}
export function horaCorta(iso) {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
}
export function horaSegundos(iso) {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
export function hace(iso) {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m} min`;
    return `desde las ${hora(iso)}`;
}
export function duracion(desdeIso, hastaIso = null) {
    const ms = (hastaIso ? Date.parse(hastaIso) : Date.now()) - Date.parse(desdeIso);
    const m = Math.round(ms / 60000);
    return m < 1 ? "menos de 1 min" : `${m} min`;
}
export function saludo() {
    const h = new Date().getHours();
    return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}
export function fechaLarga() {
    return new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
}

/** Cambia el contenido solo si es distinto (evita perder el foco en botones al refrescar cada segundo). */
const ultimoHtml = new WeakMap();
export function pintar(el, html) {
    if (el && ultimoHtml.get(el) !== html) {
        el.innerHTML = html;
        ultimoHtml.set(el, html);
    }
}

// ---------- Conexión ----------
export function pintarConexion() {
    const textos = { conectando: "Conectando…", en_vivo: "En vivo", reconectando: "Sin conexión, reintentando…" };
    const el = document.getElementById("conexion");
    if (!el) return;
    el.dataset.estado = estado.conexion;
    document.getElementById("conexion-texto").textContent = textos[estado.conexion];
}

// ---------- Avisos ----------
const enlaceFinca = id => `finca.html?id=${encodeURIComponent(id)}`;

export function htmlAviso(a, { conNombre = true } = {}) {
    const titulo = conNombre ? `<a href="${enlaceFinca(a.finca)}">${nombreFinca(a.finca)}</a> · ` : "";
    if (a.nivel === "sin_senal") {
        return `<li class="aviso" data-nivel="sin_senal">
            <div class="aviso-titulo">${titulo}<span>Sin señal</span></div>
            <p>El sensor no está enviando datos. Revise la conexión o la batería.</p>
            ${a.desde ? `<small>Último dato a las ${hora(a.desde)}</small>` : ""}
        </li>`;
    }
    const v = config().variables[a.variable];
    const accion = a.hecho
        ? `<span class="marca-hecho">${icono(SVG_HECHO)}Hecho a las ${hora(a.hecho)}</span>`
        : `<button class="boton acento" type="button" data-hecho="${a.finca}|${a.variable}">Marcar como hecho</button>`;
    return `<li class="aviso${a.hecho ? " hecho" : ""}" data-nivel="${a.nivel}">
        <div class="aviso-titulo">${titulo}<span>${a.palabra}</span></div>
        <p>${a.consejo}</p>
        <small>${v.corto}: ${formatearValor(a.variable, a.valor)} ${v.unidad} · desde las ${hora(a.desde)} (${duracion(a.desde)})</small>
        <div class="aviso-acciones">${accion}</div>
    </li>`;
}

export function htmlResuelto(a) {
    const v = config().variables[a.variable];
    return `<li class="aviso">
        <div class="aviso-titulo"><a href="${enlaceFinca(a.finca)}">${nombreFinca(a.finca)}</a> · <span>${a.palabra}</span></div>
        <small>${v.corto}. Volvió a lo normal a las ${hora(a.hasta)}, duró ${duracion(a.desde, a.hasta)}.</small>
    </li>`;
}

/** Botones "Marcar como hecho" dentro de un contenedor (delegación de eventos). */
export function enlazarHechos(contenedor) {
    contenedor.addEventListener("click", e => {
        const boton = e.target.closest("[data-hecho]");
        if (!boton) return;
        e.preventDefault();
        e.stopPropagation();
        const [finca, variable] = boton.dataset.hecho.split("|");
        marcarHecho(finca, variable);
    });
}

/** Mensaje principal de una finca en pocas palabras. */
export function mensajeFinca(f) {
    if (f.nivel === "sin_senal") return "Sin señal";
    const conProblema = Object.entries(f.vars).filter(([, d]) => d.tramo.nivel !== "bien");
    if (f.nivel === "actuar") {
        const [, d] = conProblema.find(([, d]) => d.tramo.nivel === "actuar");
        return `Actúe ahora: ${d.tramo.palabra.toLowerCase()}`;
    }
    if (f.nivel === "atencion") {
        const nombres = conProblema.map(([v]) => config().variables[v].corto.toLowerCase());
        const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0];
        return `Revisar ${lista}`;
    }
    return "Todo bien";
}

export const TEXTO_INDICADOR = { bien: "Bien", atencion: "Revisar", actuar: "Actuar", sin_senal: "—" };
export { NIVELES };
