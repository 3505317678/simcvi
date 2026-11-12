#!/bin/sh
# Se ejecuta DENTRO del contenedor de InfluxDB:
#   docker compose exec influxdb sh /opt/simcvi/crear-tokens.sh
#
# Crea dos tokens de mínimo privilegio sobre el bucket de SIMCVI:
#   - escritura, para Node-RED
#   - lectura, para Grafana
# y los imprime para copiarlos en .env. El token de administración se toma del
# entorno del contenedor, así no aparece en el historial de la terminal del equipo.
set -eu

: "${DOCKER_INFLUXDB_INIT_ADMIN_TOKEN:?No se encontró el token de administración en el contenedor.}"
ORG="${DOCKER_INFLUXDB_INIT_ORG:?}"
BUCKET="${DOCKER_INFLUXDB_INIT_BUCKET:?}"
export INFLUX_TOKEN="$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN"

ID="$(influx bucket list --org "$ORG" --name "$BUCKET" --hide-headers | awk 'NR == 1 { print $1 }')"
if [ -z "$ID" ]; then
  echo "No se encontró el bucket «$BUCKET» en la organización «$ORG»." >&2
  exit 1
fi

token_de() {
  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

ESCRITURA="$(influx auth create --org "$ORG" --write-bucket "$ID" --description "SIMCVI Node-RED (escritura)" --json | token_de)"
LECTURA="$(influx auth create --org "$ORG" --read-bucket "$ID" --description "SIMCVI Grafana (lectura)" --json | token_de)"

if [ -z "$ESCRITURA" ] || [ -z "$LECTURA" ]; then
  echo "No se pudo leer el token creado. Revise los tokens en http://localhost:8086 (Load Data > API Tokens)." >&2
  exit 1
fi

echo "Tokens creados. InfluxDB los guarda con hash: esta es la única vez que se muestran."
echo "Reemplace estas dos líneas en .env y ejecute 'docker compose up -d':"
echo
echo "NODERED_INFLUX_TOKEN=$ESCRITURA"
echo "GRAFANA_INFLUX_TOKEN=$LECTURA"
