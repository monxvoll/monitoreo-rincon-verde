// Rangos, fincas y textos: se leen de config/rangos.json, el mismo archivo que usa el backend.
// Cada finca tiene un tipo (ganaderia, papa, tomate) y cada tipo tiene sus propios rangos.

let CONFIG = null;

export const NIVELES = {
    actuar: { orden: 0, texto: "Actuar ahora" },
    sin_senal: { orden: 1, texto: "Sin señal" },
    atencion: { orden: 2, texto: "Atención" },
    bien: { orden: 3, texto: "Bien" },
};

export async function cargarRangos() {
    if (!CONFIG) {
        const res = await fetch("config/rangos.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(`No se pudo leer rangos.json (HTTP ${res.status})`);
        CONFIG = await res.json();
    }
    return CONFIG;
}

export const config = () => CONFIG;
export const VARIABLES = () => Object.keys(CONFIG.variables);
export const IDS_FINCAS = () => Object.keys(CONFIG.fincas);

export const finca = id => CONFIG.fincas[id];
export const nombreFinca = id => CONFIG?.fincas?.[id]?.nombre ?? `Finca ${String(id).split("_")[1]}`;
export const tipoDe = id => CONFIG.tipos[CONFIG.fincas[id].tipo];

/** Reglas de una variable para una finca: datos generales + rangos de su tipo. */
export function reglas(fincaId, variable) {
    return { ...CONFIG.variables[variable], ...tipoDe(fincaId).variables[variable] };
}

/** Tramo ({nivel, palabra, consejo}) en el que cae un valor para esa finca. */
export function clasificar(fincaId, variable, valor) {
    const tramos = reglas(fincaId, variable).tramos;
    return tramos.find(t => t.hasta === null || valor <= t.hasta) ?? tramos[tramos.length - 1];
}

/** El nivel mas grave de una lista de niveles. */
export function peorNivel(niveles) {
    return niveles.reduce((peor, n) => (NIVELES[n].orden < NIVELES[peor].orden ? n : peor), "bien");
}

/** Limites [min, max] del tramo "bien" (la franja ideal). */
export function franjaIdeal(fincaId, variable) {
    const r = reglas(fincaId, variable);
    const i = r.tramos.findIndex(t => t.nivel === "bien");
    const min = i > 0 ? r.tramos[i - 1].hasta : r.escala[0];
    const max = r.tramos[i].hasta ?? r.escala[1];
    return [min, max];
}

/** Valor a partir del cual la variable entra en "actuar" por arriba (null si no tiene). */
export function umbralSuperior(fincaId, variable) {
    const t = reglas(fincaId, variable).tramos;
    return t[t.length - 1].nivel === "actuar" ? t[t.length - 2].hasta : null;
}

/** Tramos con su inicio y fin dentro de la escala, para dibujar la barra por zonas. */
export function zonas(fincaId, variable) {
    const r = reglas(fincaId, variable);
    let desde = r.escala[0];
    return r.tramos.map(t => {
        const hasta = Math.min(t.hasta ?? r.escala[1], r.escala[1]);
        const zona = { ...t, desde, hasta };
        desde = hasta;
        return zona;
    }).filter(z => z.hasta > z.desde);
}

export function formatearValor(variable, valor) {
    const d = CONFIG.variables[variable].decimales;
    return Number(valor).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Rango ideal en texto: "18 a 27 °C". */
export function textoIdeal(fincaId, variable) {
    const [min, max] = franjaIdeal(fincaId, variable);
    const u = CONFIG.variables[variable].unidad;
    const f = n => Number(n).toLocaleString("es-CO");
    const r = reglas(fincaId, variable);
    if (min === r.escala[0]) return `hasta ${f(max)} ${u}`;
    return `${f(min)} a ${f(max)} ${u}`;
}
