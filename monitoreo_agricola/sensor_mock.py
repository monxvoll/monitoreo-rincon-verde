import time
import json
import random
import os
import redis
from datetime import datetime, timezone
from pathlib import Path

# Configuracion de Redis
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
r = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True)

# Fincas y su tipo: se leen de frontend/config/rangos.json (el mismo archivo del panel)
RANGOS_PATH = Path(__file__).resolve().parent / "frontend" / "config" / "rangos.json"
if RANGOS_PATH.exists():
    _fincas = json.loads(RANGOS_PATH.read_text(encoding="utf-8"))["fincas"]
    TIPO_FINCA = {finca: datos["tipo"] for finca, datos in _fincas.items()}
else:
    NUM_FINCAS = int(os.getenv("NUM_FINCAS", "6"))
    TIPO_FINCA = {f"finca_{i}": "tomate" for i in range(1, NUM_FINCAS + 1)}
FINCAS = list(TIPO_FINCA.keys())

# MODO_DEMO=1 amplia los rangos y debilita el regreso a lo normal para que aparezcan
# todos los estados (heladas, calor, hongos, aire cargado) durante una presentacion.
MODO_DEMO = os.getenv("MODO_DEMO", "0") == "1"

# Fincas que dejan de enviar datos, para mostrar el estado "Sin senal" (ej: "finca_6")
FINCAS_SIN_SENAL = {f.strip() for f in os.getenv("FINCAS_SIN_SENAL", "").split(",") if f.strip()}

# Perfil de cada tipo de finca: variable -> (minimo, maximo, paso maximo por lectura, valor tipico)
#  - ganaderia: establo lechero; el CO2 sube porque los animales respiran
#  - papa: campo abierto en el altiplano; noches frias y el CO2 casi no cambia
#  - tomate: invernadero; calor de dia y CO2 moderado
PERFILES = {
    "ganaderia": {
        "temperatura": (2.0, 30.0, 1.5, 16.0),
        "humedad": (35.0, 95.0, 3.2, 66.0),
        "co2": (500.0, 3000.0, 140.0, 1250.0),
    },
    "papa": {
        "temperatura": (-1.0, 27.0, 1.5, 13.0),
        "humedad": (40.0, 100.0, 3.2, 76.0),
        "co2": (395.0, 470.0, 6.0, 420.0),
    },
    "tomate": {
        "temperatura": (15.0, 35.0, 1.2, 23.0),
        "humedad": (40.0, 90.0, 2.5, 68.0),
        "co2": (400.0, 1000.0, 45.0, 560.0),
    },
}

if MODO_DEMO:
    # Rango 30 % mas amplio (sin pasar de 0-100 % de humedad) y pasos mas grandes
    for perfil in PERFILES.values():
        for k, (lo, hi, paso, centro) in perfil.items():
            extra = 0.15 * (hi - lo)
            lo, hi = lo - extra, hi + extra
            if k == "humedad":
                lo, hi = max(lo, 0.0), min(hi, 100.0)
            perfil[k] = (lo, hi, paso * 1.5, centro)

# Que tan fuerte vuelve cada variable a su valor tipico
RETORNO = 0.015 if MODO_DEMO else 0.025

def _perfil(finca_id):
    return PERFILES.get(TIPO_FINCA[finca_id], PERFILES["tomate"])

# Estado actual de cada finca: deriva suave (random walk acotado) para que
# las graficas muestren tendencias legibles en lugar de ruido puro.
estado = {
    finca: {k: centro + random.uniform(-0.25, 0.25) * (hi - lo)
            for k, (lo, hi, _, centro) in _perfil(finca).items()}
    for finca in FINCAS
}

def _avanzar(valor, lo, hi, paso, centro):
    valor += random.uniform(-paso, paso) + RETORNO * (centro - valor)
    return max(lo, min(hi, valor))

def generar_datos(finca_id):
    """Genera datos simulados realistas para una finca (con deriva suave)."""
    for k, (lo, hi, paso, centro) in _perfil(finca_id).items():
        estado[finca_id][k] = _avanzar(estado[finca_id][k], lo, hi, paso, centro)

    temperatura = round(estado[finca_id]["temperatura"], 1)  # grados Celsius
    humedad = round(estado[finca_id]["humedad"], 1)          # porcentaje
    co2 = round(estado[finca_id]["co2"], 1)                  # partes por millon

    # Con zona horaria (UTC) para que el navegador la convierta bien a la hora local
    timestamp = datetime.now(timezone.utc).isoformat()

    return {
        "finca_id": finca_id,
        "timestamp": timestamp,
        "temperatura": temperatura,
        "humedad": humedad,
        "co2": co2
    }

def simular_y_enviar():
    print(f"Iniciando simulador de sensores... (modo demo: {'si' if MODO_DEMO else 'no'})")
    if FINCAS_SIN_SENAL:
        print(f"Fincas sin senal: {', '.join(sorted(FINCAS_SIN_SENAL))}")
    try:
        r.ping()
        print("Conectado a Redis exitosamente.")
    except redis.ConnectionError:
        print("ERROR: No se pudo conectar a Redis. Asegurate de que el servidor Redis este en ejecucion.")
        return

    while True:
        try:
            for finca in FINCAS:
                if finca in FINCAS_SIN_SENAL:
                    continue
                datos = generar_datos(finca)
                datos_json = json.dumps(datos)

                # Guardar el estado actual de la finca
                r.set(f"{finca}:estado_actual", datos_json)

                # Agregar al historial y recortar a los ultimos 50 registros
                historial_key = f"{finca}:historial"
                r.lpush(historial_key, datos_json)
                r.ltrim(historial_key, 0, 49)

                # Publicar en el canal Pub/Sub para tiempo real
                r.publish("fincas_updates", datos_json)

                print(f"[{datos['timestamp']}] {finca}: Temp={datos['temperatura']}C, Hum={datos['humedad']}%, CO2={datos['co2']}ppm")

            # Esperar 5 segundos antes de la siguiente lectura
            time.sleep(5)

        except Exception as e:
            print(f"Error durante la simulacion: {e}")
            time.sleep(5)

if __name__ == "__main__":
    simular_y_enviar()
