# Monitoreo Agricola - Rincon Verde

Sistema de monitoreo en tiempo real para dos fincas agricolas. Mide temperatura, humedad y CO2 cada 5 segundos usando sensores simulados, almacena datos en Redis y los muestra en un dashboard web con actualizacion en vivo via WebSockets.

## Stack

- **Simulador**: Python (`sensor_mock.py`)
- **Base de datos**: Redis (en memoria)
- **Backend**: FastAPI + Uvicorn
- **Frontend**: HTML5 + CSS + JavaScript vanilla
- **Contenedores**: Docker + Docker Compose

## Requisitos

- Docker y Docker Compose (recomendado)
O para ejecucion local pura:
- Python 3.10+
- Redis local
- pip

## Ejecucion con Docker (Recomendado)

La forma mas rapida de levantar todo el proyecto es mediante Docker Compose.

1. Asegurate de tener Docker en ejecucion.
2. Abre una terminal en la raiz del proyecto y ejecuta:

```bash
docker compose up -d --build
```

Esto levantara:
- El servidor de Redis
- El Backend (FastAPI) en el puerto `8000`
- El Frontend (Nginx/Servidor estatico) en el puerto `8080` (o el puerto configurado)
- El Simulador de sensores en segundo plano

Para detener todos los servicios:
```bash
docker compose down
```

## Ejecucion Manual (Sin Docker)

Si prefieres ejecutar el sistema sin Docker, abre 3 terminales y asegurate de tener Redis corriendo en el puerto 6379.

**Redis con Docker (solo para la base de datos):**
```bash
docker run -d --name redis-server -p 6379:6379 redis
```

**Terminal 1 - Backend:**
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 - Simulador:**
```bash
source venv/bin/activate
python sensor_mock.py
```

**Terminal 3 - Frontend:**
```bash
cd frontend
python -m http.server 8080
```

Abrir en el navegador: `http://localhost:8080`

## Estructura

```
monitoreo_agricola/
├── docker-compose.yml      # Configuracion de servicios Docker
├── Dockerfile              # Construccion de la imagen base de Python
├── sensor_mock.py          # Simulador de sensores
├── backend/
│   └── main.py             # API REST + WebSocket
├── frontend/
│   ├── index.html          # Panel de control
│   └── js/
│       └── ui.js           # Logica del cliente
├── requirements.txt
└── .gitignore
```

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/historial/{finca}` | Historial reciente de una finca |
| WS | `/ws/monitoreo` | Datos en tiempo real via WebSocket |

## Umbrales de alerta

- Temperatura > 30 C
- CO2 > 800 ppm
