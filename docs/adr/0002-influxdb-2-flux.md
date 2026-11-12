# ADR-0002 · InfluxDB 2.9 con Flux en lugar de InfluxDB 3 Core con SQL

- Estado: aceptada (contradice la versión 3 del documento de avance, que proponía InfluxDB 3 Core)
- Fecha: 2026-10-08

## Contexto

El equipo debe trabajar con Node-RED, Flux y Grafana. Flux es el lenguaje de consulta de InfluxDB 2.x; InfluxData lo mantiene en modo de mantenimiento y **InfluxDB 3 no lo soporta** (usa SQL e InfluxQL). Con InfluxDB 3 Core no sería posible cumplir el requisito de usar Flux.

## Decisión

Usar la imagen oficial `influxdb:2.9.1` (rama 2.x más reciente) con una organización y un bucket creados en la primera ejecución. Node-RED escribe con la API `/api/v2/write` en protocolo de línea; Grafana consulta con Flux.

## Alternativas consideradas

| Alternativa | Ventaja | Desventaja |
|---|---|---|
| InfluxDB 3 Core + SQL | Producto vigente, mejor rendimiento en consultas analíticas | Sin Flux: incumple el requisito del curso |
| InfluxDB 1.x + InfluxQL | Sencillo | Rama antigua; tampoco usa Flux por defecto |
| PostgreSQL + TimescaleDB | SQL estándar, relaciones | Fuera del alcance definido (series de tiempo con Flux) |

## Consecuencias

- Hay que ajustar el documento: secciones 8.4.2 y 8.4.3, la Tabla 7 y la Figura 1 (puerto 8086 en lugar de 8181).
- InfluxDB 2.9 guarda los tokens con hash: el valor en texto plano solo se conoce al crearlo; por eso se conserva en `.env`.
- La migración futura a InfluxDB 3 implica reescribir las consultas de Grafana en SQL; la escritura desde Node-RED (protocolo de línea) se conserva.
