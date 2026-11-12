# ADR-0004 · Interfaz de operación propia y Grafana embebido para el histórico

- Estado: aceptada
- Fecha: 2026-10-08

## Contexto

Se necesita una interfaz que muestre la planta en tiempo real, permita operar las válvulas y ejecutar los escenarios de prueba, y que además evidencie el recorrido de los datos (Node-RED → InfluxDB → Grafana). El histórico y el análisis de tendencias largas son la fortaleza de Grafana.

## Decisión

- Interfaz propia en HTML, CSS y JavaScript nativo (módulos ES), servida por Node-RED, sin proceso de compilación. Sigue criterios de HMI de alto rendimiento: grises neutros y color solo para condiciones anormales (rojo alarma, ámbar aviso), barras analógicas con la banda del rango normal, válvulas con símbolo ISA y textos que no dependen del color.
- Chart.js 4.5.1 y las fuentes Barlow se incluyen en `ui/vendor` para funcionar sin internet.
- Grafana 13 muestra el tablero `simcvi-planta` (consultas Flux) y se embebe en la vista «Grafana» con acceso anónimo de solo lectura.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Node-RED Dashboard 2 | Rápido para prototipos, pero limita el diseño de un sinóptico HMI y de la vista de pruebas. |
| React o Vue con compilación | Más herramientas y dependencias que el tamaño del proyecto no justifica. |
| Solo Grafana | No permite operar válvulas ni ejecutar escenarios con validación. |

## Consecuencias

- Cero dependencias de npm en el navegador y una Content Security Policy estricta (`script-src 'self'`).
- Si cambia la dirección de Grafana, hay que actualizar `frame-src` en `ui/index.html`.
- Si la interfaz crece mucho (usuarios, roles, más pantallas), conviene migrar a un framework con componentes y pruebas de interfaz automatizadas.
