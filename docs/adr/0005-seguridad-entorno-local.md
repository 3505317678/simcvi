# ADR-0005 · Controles de seguridad para un despliegue local

- Estado: aceptada
- Fecha: 2026-10-08

## Contexto

El sistema se ejecuta en el equipo de los estudiantes para desarrollo y sustentación. Aun así, controla válvulas (simuladas) y guarda credenciales, por lo que la seguridad se diseña desde el inicio con referencia a OWASP ASVS y OWASP API Security Top 10, en la medida aplicable a un entorno local.

## Decisión

| Riesgo | Control |
|---|---|
| Acceso desde la red a la API sin autenticación | Puertos publicados solo en `127.0.0.1` (Node-RED, InfluxDB, Grafana). |
| Secretos en el código o en Git | Secretos aleatorios en `.env` (generado por `scripts/init-env`), incluido en `.gitignore`; `docker-compose.yml` se niega a arrancar si faltan. |
| Editor de Node-RED abierto | `adminAuth` con usuario y contraseña del entorno, comparación en tiempo constante; Node-RED no arranca con contraseñas de menos de 12 caracteres. |
| Token con privilegios excesivos | Procedimiento de tokens de mínimo privilegio: escritura para Node-RED y lectura para Grafana (README). |
| Entradas maliciosas en la API | Enrutador con listas blancas, validación atómica de la configuración y respuestas 400, 404, 409 y 422. |
| Inyección de HTML en la interfaz | Todo texto se inserta con `textContent`; CSP sin `unsafe-inline` ni `unsafe-eval`. |
| Escalada dentro de los contenedores | `no-new-privileges` y `cap_drop: ALL` en Node-RED y Grafana; ambos corren con usuario no root. |
| Registros que llenan el disco | Rotación de registros de Docker (3 archivos de 10 MB). |

## Riesgos aceptados

- La API y el WebSocket de Node-RED no tienen autenticación: solo son aceptables mientras el puerto esté limitado a `127.0.0.1`. Antes de exponer el sistema en una red, agregar autenticación (por ejemplo `httpNodeAuth` de Node-RED o un proxy inverso con OIDC) y HTTPS.
- Grafana permite lectura anónima para poder embeberse; quien acceda al puerto 3000 local puede ver los tableros.
- El arranque rápido usa el token de administración de InfluxDB en Node-RED y Grafana hasta aplicar el procedimiento de mínimo privilegio.
- Los secretos viajan como variables de entorno (visibles con `docker inspect` para quien administre Docker). La evolución es usar *Docker secrets* o un gestor de secretos.
