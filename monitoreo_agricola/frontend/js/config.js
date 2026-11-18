export const API_URL = "http://localhost:8000/api/historial";
export const WS_URL = "ws://localhost:8000/ws/monitoreo";

export const NUM_FINCAS = 6;
export const FINCAS = Array.from({ length: NUM_FINCAS }, (_, i) => `finca_${i + 1}`);
export const nombreFinca = (id) => `Finca ${id.split("_")[1]}`;

export const UMBRAL_TEMP = 30.0;
export const UMBRAL_CO2 = 800.0;
export const MAX_HISTORIAL = 50;
export const INTERVALO_ALERTAS_MS = 15000; // 15 segundos entre alertas
