"""Backends de almacenamiento reutilizables por el benchmark y el comparador."""

import json
import queue
import threading

CANAL_TIEMPO_REAL = "fincas_updates"
FINCA_BENCHMARK = "bench_finca"
MAX_HISTORIAL = 50


class PostgresBackend:
    nombre = "postgres"

    def __init__(self, url: str):
        import psycopg

        self.psycopg = psycopg
        self.url = url
        self.conn = psycopg.connect(url)
        self.listener_conn = None
        self.detener = threading.Event()
        self.hilo_listener = None

    def escribir(self, datos: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO lecturas (finca_id, ts, temperatura, humedad, co2)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    datos["finca_id"],
                    datos["timestamp"],
                    datos["temperatura"],
                    datos["humedad"],
                    datos["co2"],
                ),
            )
        self.conn.commit()

    def leer_historial(self, finca_id: str = FINCA_BENCHMARK) -> list:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT finca_id, ts, temperatura, humedad, co2
                FROM lecturas
                WHERE finca_id = %s
                ORDER BY ts DESC
                LIMIT %s
                """,
                (finca_id, MAX_HISTORIAL),
            )
            return cur.fetchall()

    def iniciar_listener(self, cola: queue.Queue) -> None:
        self.listener_conn = self.psycopg.connect(self.url, autocommit=True)
        self.listener_conn.execute(f"LISTEN {CANAL_TIEMPO_REAL}")

        def escuchar():
            try:
                while not self.detener.is_set():
                    for notify in self.listener_conn.notifies(timeout=0.5):
                        cola.put(notify.payload)
            except Exception:
                pass

        self.hilo_listener = threading.Thread(target=escuchar, daemon=True)
        self.hilo_listener.start()

    def cerrar(self) -> None:
        self.detener.set()
        if self.hilo_listener is not None:
            self.hilo_listener.join(timeout=2)
        if self.listener_conn is not None:
            try:
                self.listener_conn.close()
            except Exception:
                pass
        self.conn.close()


class RedisBackend:
    nombre = "redis"

    def __init__(self, url: str):
        import redis

        self.redis = redis.Redis.from_url(url, decode_responses=True)
        self.pubsub = None
        self.detener = threading.Event()
        self.hilo_listener = None

    def escribir(self, datos: dict) -> None:
        payload = json.dumps(datos)
        clave = datos["finca_id"]
        pipe = self.redis.pipeline()
        pipe.set(f"{clave}:estado_actual", payload)
        pipe.lpush(f"{clave}:historial", payload)
        pipe.ltrim(f"{clave}:historial", 0, MAX_HISTORIAL - 1)
        pipe.publish(CANAL_TIEMPO_REAL, payload)
        pipe.execute()

    def leer_historial(self, finca_id: str = FINCA_BENCHMARK) -> list:
        return self.redis.lrange(f"{finca_id}:historial", 0, MAX_HISTORIAL - 1)

    def iniciar_listener(self, cola: queue.Queue) -> None:
        self.pubsub = self.redis.pubsub(ignore_subscribe_messages=True)
        self.pubsub.subscribe(CANAL_TIEMPO_REAL)

        def escuchar():
            while not self.detener.is_set():
                mensaje = self.pubsub.get_message(timeout=0.5)
                if mensaje and mensaje.get("type") == "message":
                    cola.put(mensaje["data"])

        self.hilo_listener = threading.Thread(target=escuchar, daemon=True)
        self.hilo_listener.start()

    def cerrar(self) -> None:
        self.detener.set()
        if self.hilo_listener is not None:
            self.hilo_listener.join(timeout=2)
        if self.pubsub is not None:
            try:
                self.pubsub.close()
            except Exception:
                pass
        self.redis.close()
