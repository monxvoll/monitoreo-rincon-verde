// El backend corre en el mismo equipo que sirve el panel, en el puerto 8000.
// Usar location.hostname permite abrir el panel desde un celular en la misma red.
const HOST = location.hostname || "localhost";
export const API_BASE = `http://${HOST}:8000`;
export const API_URL = `${API_BASE}/api/historial`;
export const WS_URL = `ws://${HOST}:8000/ws/monitoreo`;

export { nombreFinca } from './rangos.js';
import { IDS_FINCAS } from './rangos.js';

// Lista de fincas (disponible despues de cargarRangos())
export const fincas = () => IDS_FINCAS();

export const MAX_HISTORIAL = 50;
export const INTERVALO_ALERTAS_MS = 15000; // 15 segundos entre alertas
