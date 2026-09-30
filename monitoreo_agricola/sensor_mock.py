import time
import json
import random
import os
import redis
from datetime import datetime

# Configuracion de Redis
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
r = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True)

# Identificadores de las dos fincas
FINCAS = ["finca_1", "finca_2"]

def generar_datos(finca_id):
    """Genera datos simulados realistas para una finca."""
    temperatura = round(random.uniform(15.0, 35.0), 1)  # grados Celsius
    humedad = round(random.uniform(40.0, 90.0), 1)      # porcentaje
    co2 = round(random.uniform(400.0, 1000.0), 1)       # partes por millon

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
