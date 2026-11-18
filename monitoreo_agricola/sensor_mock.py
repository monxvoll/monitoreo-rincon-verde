import os
import random
import time
from datetime import datetime, timezone

import psycopg

# Configuracion de PostgreSQL
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/monitoreo",
)

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

INSERT_SQL = """
INSERT INTO lecturas (finca_id, ts, temperatura, humedad, co2)
VALUES (%s, %s, %s, %s, %s)
"""


def generar_datos(finca_id):
    """Genera datos simulados realistas para una finca (con deriva suave)."""
    for k, (lo, hi, paso) in RANGOS.items():
        estado[finca_id][k] = _avanzar(estado[finca_id][k], lo, hi, paso)

    temperatura = round(estado[finca_id]["temperatura"], 1)  # grados Celsius
    humedad = round(estado[finca_id]["humedad"], 1)          # porcentaje
    co2 = round(estado[finca_id]["co2"], 1)                  # partes por millon

    timestamp = datetime.now(timezone.utc)

    return {
        "finca_id": finca_id,
        "timestamp": timestamp,
        "temperatura": temperatura,
        "humedad": humedad,
        "co2": co2,
    }


def conectar():
    """Intenta conectar a PostgreSQL reintentando hasta lograrlo."""
    while True:
        try:
            conn = psycopg.connect(DATABASE_URL)
            print("Conectado a PostgreSQL exitosamente.")
            return conn
        except psycopg.OperationalError as e:
            print(
                "ERROR: No se pudo conectar a PostgreSQL "
                f"({e}). Reintentando en 5 segundos..."
            )
            time.sleep(5)


def simular_y_enviar():
    print("Iniciando simulador de sensores...")
    conn = conectar()

    try:
        while True:
            try:
                for finca in FINCAS:
                    datos = generar_datos(finca)

                    with conn.cursor() as cur:
                        cur.execute(
                            INSERT_SQL,
                            (
                                datos["finca_id"],
                                datos["timestamp"],
                                datos["temperatura"],
                                datos["humedad"],
                                datos["co2"],
                            ),
                        )
                    conn.commit()

                    print(
                        f"[{datos['timestamp'].isoformat()}] {finca}: "
                        f"Temp={datos['temperatura']}C, "
                        f"Hum={datos['humedad']}%, "
                        f"CO2={datos['co2']}ppm"
                    )

                # Esperar 5 segundos antes de la siguiente lectura
                time.sleep(5)

            except psycopg.Error as e:
                print(f"Error durante la simulacion: {e}")
                try:
                    conn.close()
                except Exception:
                    pass
                conn = conectar()
                time.sleep(5)

    except KeyboardInterrupt:
        print("Simulador detenido.")
    finally:
        conn.close()


if __name__ == "__main__":
    simular_y_enviar()
