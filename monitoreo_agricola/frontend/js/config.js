const HOST = window.location.hostname || "localhost";
export const MOTOR = document.body?.dataset?.motor === "redis" ? "redis" : "postgres";
const PUERTO_MOTOR = MOTOR === "redis" ? 8001 : 8000;

export const API_URL = `http://${HOST}:${PUERTO_MOTOR}/api/historial`;
export const WS_URL = `ws://${HOST}:${PUERTO_MOTOR}/ws/monitoreo`;

export const COMPARADOR_API_URL = `http://${HOST}:8010/api/resumen`;
export const COMPARADOR_WS_URL = `ws://${HOST}:8010/ws/comparacion`;

export const NUM_FINCAS = 6;
export const FINCAS = Array.from({ length: NUM_FINCAS }, (_, i) => `finca_${i + 1}`);
export const nombreFinca = (id) => `Finca ${id.split("_")[1]}`;

export const UMBRAL_TEMP = 30.0;
export const UMBRAL_CO2 = 800.0;
export const MAX_HISTORIAL = 50;
export const INTERVALO_ALERTAS_MS = 15000; // 15 segundos entre alertas
