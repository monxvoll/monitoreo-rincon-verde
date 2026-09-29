import { API_URL, FINCAS, UMBRAL_TEMP, UMBRAL_CO2 } from './config.js';
import { actualizarTarjeta, agregarFilaTabla } from './ui.js';

export async function cargarHistorial() {
    for (const finca of FINCAS) {
        try {
            const res = await fetch(`${API_URL}/${finca}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const tbody = document.getElementById(`table-${finca}`);
            tbody.innerHTML = "";

            data.historial.forEach((reg, i) => {
                reg.finca_id = finca;
                reg.alerta = reg.temperatura > UMBRAL_TEMP || reg.co2 > UMBRAL_CO2;
                agregarFilaTabla(reg, false);

                if (i === 0) actualizarTarjeta(reg);
            });
        } catch (err) {
            console.error(`Error cargando historial de ${finca}:`, err);
        }
    }
}
