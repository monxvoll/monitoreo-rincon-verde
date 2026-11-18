import time
import json
import random
import os
import redis
from datetime import datetime

# Configuracion de Redis
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
r = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True)

# Identificadores de las fincas (configurable con NUM_FINCAS)
NUM_FINCAS = int(os.getenv("NUM_FINCAS", "6"))
FINCAS = [f"finca_{i}" for i in range(1, NUM_FINCAS + 1)]

# Rangos de cada variable: (minimo, maximo, paso maximo por lectura)
RANGOS = {
    "temperatura": (15.0, 35.0, 1.2),
    "humedad": (40.0, 90.0, 2.5),
    "co2": (400.0, 1000.0, 45.0),
}

# Estado actual de cada finca: deriva suave (random walk acotado) para que
# las graficas muestren tendencias legibles en lugar de ruido puro.
estado = {
    finca: {k: random.uniform(lo, hi) for k, (lo, hi, _) in RANGOS.items()}
    for finca in FINCAS
}

def _avanzar(valor, lo, hi, paso):
    valor += random.uniform(-paso, paso)
    return max(lo, min(hi, valor))

def generar_datos(finca_id):
    """Genera datos simulados realistas para una finca (con deriva suave)."""
    for k, (lo, hi, paso) in RANGOS.items():
        estado[finca_id][k] = _avanzar(estado[finca_id][k], lo, hi, paso)

    temperatura = round(estado[finca_id]["temperatura"], 1)  # grados Celsius
    humedad = round(estado[finca_id]["humedad"], 1)          # porcentaje
    co2 = round(estado[finca_id]["co2"], 1)                  # partes por millon

    timestamp = datetime.now().isoformat()

    return {
        "finca_id": finca_id,
        "timestamp": timestamp,
        "temperatura": temperatura,
        "humedad": humedad,
        "co2": co2
    }

def simular_y_enviar():
    print("Iniciando simulador de sensores...")
    try:
        r.ping()
        print("Conectado a Redis exitosamente.")
    except redis.ConnectionError:
        print("ERROR: No se pudo conectar a Redis. Asegurate de que el servidor Redis este en ejecucion.")
        return

    while True:
        try:
            for finca in FINCAS:
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
