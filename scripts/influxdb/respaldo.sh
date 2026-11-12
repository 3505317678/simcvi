#!/bin/sh
# Se ejecuta DENTRO del contenedor de InfluxDB:
#   docker compose exec influxdb sh /opt/simcvi/respaldo.sh
# Copie después el respaldo al equipo con:
#   docker compose cp influxdb:/var/lib/influxdb2/respaldos ./respaldos
set -eu

: "${DOCKER_INFLUXDB_INIT_ADMIN_TOKEN:?No se encontró el token de administración en el contenedor.}"
export INFLUX_TOKEN="$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN"

DESTINO="/var/lib/influxdb2/respaldos/$(date +%Y%m%d-%H%M%S)"
influx backup "$DESTINO"
echo "Respaldo creado en $DESTINO (dentro del contenedor)."
