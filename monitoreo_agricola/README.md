# Monitoreo Agricola - Rincon Verde

Sistema de monitoreo en tiempo real para dos fincas agricolas. Mide temperatura, humedad y CO2 cada 5 segundos usando sensores simulados, almacena datos en Redis y los muestra en un dashboard web con actualizacion en vivo via WebSockets.

## Stack

- **Simulador**: Python (`sensor_mock.py`)
- **Base de datos**: Redis (en memoria)
- **Backend**: FastAPI + Uvicorn
- **Frontend**: HTML5 + CSS + JavaScript vanilla
- **Contenedores**: Docker + Docker Compose

## Requisitos

- Docker y Docker Compose
## Ejecución

El proyecto se debe iniciar utilizando Docker Compose.

1. Es necesario tener Docker en ejecución.
2. Desde una terminal en la raíz del proyecto, ejecutar el siguiente comando:

```bash
docker compose up -d --build
```

Este comando iniciará:
- El servidor de Redis
- El Backend (FastAPI) en el puerto `8000`
- El Frontend (Nginx/Servidor estático) en el puerto `8080`
- El Simulador de sensores en segundo plano

Para detener todos los servicios, ejecutar:
```bash
docker compose down
```

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
