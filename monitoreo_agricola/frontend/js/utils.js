export function formatearHora(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function pct(value, min, max) {
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
