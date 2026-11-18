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

# Identificadores de las dos fincas
FINCAS = ["finca_1", "finca_2"]

INSERT_SQL = """
INSERT INTO lecturas (finca_id, ts, temperatura, humedad, co2)
VALUES (%s, %s, %s, %s, %s)
"""


def generar_datos(finca_id):
    """Genera datos simulados realistas para una finca."""
    temperatura = round(random.uniform(15.0, 35.0), 1)  # grados Celsius
    humedad = round(random.uniform(40.0, 90.0), 1)      # porcentaje
    co2 = round(random.uniform(400.0, 1000.0), 1)       # partes por millon

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
