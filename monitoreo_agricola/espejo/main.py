"""Espejo de lecturas PostgreSQL -> Redis.

Escucha las notificaciones de PostgreSQL y replica las mismas lecturas en Redis
para que ambos dashboards muestren datos identicos sin un segundo simulador.
"""

import json
import os
import time
from datetime import datetime, timezone

import psycopg
import redis

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/monitoreo",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CANAL_TIEMPO_REAL = "fincas_updates"
NUM_FINCAS = int(os.getenv("NUM_FINCAS", "6"))
PREFIJO_FINCAS = os.getenv("PREFIJO_FINCAS", "finca_")
MAX_HISTORIAL = 50


def conectar_postgres() -> "psycopg.Connection":
    while True:
        try:
            conn = psycopg.connect(DATABASE_URL)
            print("Espejo conectado a PostgreSQL.")
            return conn
        except psycopg.OperationalError as e:
            print(f"PostgreSQL no disponible ({e}). Reintentando en 2 segundos...")
            time.sleep(2)


def conectar_redis() -> "redis.Redis":
    while True:
        cliente = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        try:
            cliente.ping()
            print("Espejo conectado a Redis.")
            return cliente
        except redis.RedisError as e:
            cliente.close()
            print(f"Redis no disponible ({e}). Reintentando en 2 segundos...")
            time.sleep(2)


def fila_a_payload(fila) -> dict:
    return {
        "finca_id": fila[0],
        "timestamp": fila[1].isoformat(),
        "temperatura": fila[2],
        "humedad": fila[3],
        "co2": fila[4],
    }


def rellenar_historial(conn, redis_client) -> None:
    fincas = [f"{PREFIJO_FINCAS}{i}" for i in range(1, NUM_FINCAS + 1)]

    for finca in fincas:
        historial_key = f"{finca}:historial"
        if redis_client.llen(historial_key) > 0:
            continue

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT finca_id, ts, temperatura, humedad, co2
                FROM lecturas
                WHERE finca_id = %s
                ORDER BY ts DESC
                LIMIT %s
                """,
                (finca, MAX_HISTORIAL),
            )
            filas = cur.fetchall()

        if not filas:
            continue

        tuberia = redis_client.pipeline()
        tuberia.set(
            f"{finca}:estado_actual",
            json.dumps(fila_a_payload(filas[0]), ensure_ascii=False),
        )
        for fila in filas:
            tuberia.rpush(
                historial_key,
                json.dumps(fila_a_payload(fila), ensure_ascii=False),
            )
        tuberia.ltrim(historial_key, 0, MAX_HISTORIAL - 1)
        tuberia.execute()
        print(f"Historial inicial copiado a Redis para {finca} ({len(filas)} filas).")


def normalizar_timestamp(valor):
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def replicar(redis_client, payload: str) -> None:
    try:
        datos = json.loads(payload)
    except (TypeError, ValueError):
        return

    finca = str(datos.get("finca_id", ""))
    if not finca.startswith(PREFIJO_FINCAS):
        return

    if not {"timestamp", "temperatura", "humedad", "co2"}.issubset(datos):
        return

    timestamp = normalizar_timestamp(datos.get("timestamp"))
    if timestamp is None:
        return
    datos["timestamp"] = timestamp
    payload = json.dumps(datos, ensure_ascii=False)

    historial_key = f"{finca}:historial"
    tuberia = redis_client.pipeline()
    tuberia.set(f"{finca}:estado_actual", payload)
    tuberia.lpush(historial_key, payload)
    tuberia.ltrim(historial_key, 0, MAX_HISTORIAL - 1)
    tuberia.publish(CANAL_TIEMPO_REAL, payload)
    tuberia.execute()


def escuchar(conn, redis_client) -> None:
    conn.commit()
    conn.autocommit = True
    conn.execute(f"LISTEN {CANAL_TIEMPO_REAL}")
    print(f"Espejo escuchando {CANAL_TIEMPO_REAL}.")

    while True:
        for notify in conn.notifies(timeout=1.0):
            replicar(redis_client, notify.payload)


def main() -> None:
    conn = conectar_postgres()
    redis_client = conectar_redis()

    try:
        rellenar_historial(conn, redis_client)
        while True:
            try:
                escuchar(conn, redis_client)
            except Exception as e:
                print(f"Error en el espejo: {e}. Reconectando...")
                try:
                    conn.close()
                except Exception:
                    pass
                try:
                    redis_client.close()
                except Exception:
                    pass
                time.sleep(2)
                conn = conectar_postgres()
                redis_client = conectar_redis()
                rellenar_historial(conn, redis_client)
    except KeyboardInterrupt:
        print("Espejo detenido.")
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            redis_client.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
