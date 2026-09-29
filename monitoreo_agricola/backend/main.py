import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as redis

app = FastAPI(title="API Monitoreo Agricola Rincon Verde")

# Permitir CORS para que el frontend local pueda consumir la API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexion asincrona a Redis
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

# Umbrales criticos para generar alertas
UMBRAL_TEMPERATURA = 30.0  # grados Celsius
UMBRAL_CO2 = 800.0         # partes por millon

@app.get("/api/historial/{finca}")
async def obtener_historial(finca: str):
    """Consulta el historial reciente de una finca desde Redis."""
    historial_key = f"{finca}:historial"
    registros_str = await redis_client.lrange(historial_key, 0, -1)

    registros = [json.loads(registro) for registro in registros_str]
    return {"finca": finca, "historial": registros}

@app.websocket("/ws/monitoreo")
async def websocket_monitoreo(websocket: WebSocket):
    """WebSocket suscrito al Pub/Sub de Redis. Envia datos en tiempo real con flag de alerta."""
    await websocket.accept()

    pubsub = redis_client.pubsub()
    await pubsub.subscribe("fincas_updates")
    print("Cliente WebSocket conectado y suscrito a fincas_updates.")

    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)

            if message:
                datos = json.loads(message['data'])

                # Evaluar si algun valor supera los umbrales criticos
                alerta = False
                if datos.get("temperatura", 0) > UMBRAL_TEMPERATURA or datos.get("co2", 0) > UMBRAL_CO2:
                    alerta = True

                datos["alerta"] = alerta

                # Enviar al cliente conectado
                await websocket.send_json(datos)

            await asyncio.sleep(0.01)

    except WebSocketDisconnect:
        print("Cliente WebSocket desconectado.")
    except Exception as e:
        print(f"Error inesperado en WebSocket: {e}")
    finally:
        await pubsub.unsubscribe("fincas_updates")
        await pubsub.close()
