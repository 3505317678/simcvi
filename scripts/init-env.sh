#!/usr/bin/env bash
# Crea .env a partir de .env.example con contraseñas y tokens aleatorios.
# No sobrescribe un .env existente salvo con --forzar.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLANTILLA="$RAIZ/.env.example"
DESTINO="$RAIZ/.env"

if [[ -e "$DESTINO" && "${1:-}" != "--forzar" ]]; then
  echo "Ya existe .env y no se modificó."
  echo "Para regenerarlo use --forzar; después borre los volúmenes con 'docker compose down -v',"
  echo "porque InfluxDB y Grafana conservan las credenciales de la primera ejecución."
  exit 1
fi

# Caracteres alfanuméricos tomados de /dev/urandom (sin símbolos que Docker o Grafana interpreten).
aleatorio() {
  local largo="$1" texto=""
  while [[ "${#texto}" -lt "$largo" ]]; do
    texto+="$(head -c 256 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${texto:0:largo}"
}

TOKEN_ADMIN="$(aleatorio 64)"
INFLUX_ADMIN_PASSWORD="$(aleatorio 24)"
NR_ADMIN_PASSWORD="$(aleatorio 20)"
NR_CREDENTIAL_SECRET="$(aleatorio 40)"
GRAFANA_ADMIN_PASSWORD="$(aleatorio 20)"

# Sin arreglos asociativos: funciona también con el bash 3.2 de macOS.
valor_para() {
  case "$1" in
    INFLUX_ADMIN_PASSWORD) printf '%s' "$INFLUX_ADMIN_PASSWORD" ;;
    INFLUX_ADMIN_TOKEN | NODERED_INFLUX_TOKEN | GRAFANA_INFLUX_TOKEN) printf '%s' "$TOKEN_ADMIN" ;;
    NR_ADMIN_PASSWORD) printf '%s' "$NR_ADMIN_PASSWORD" ;;
    NR_CREDENTIAL_SECRET) printf '%s' "$NR_CREDENTIAL_SECRET" ;;
    GRAFANA_ADMIN_PASSWORD) printf '%s' "$GRAFANA_ADMIN_PASSWORD" ;;
    *) return 1 ;;
  esac
}

umask 077
TEMPORAL="$(mktemp "$RAIZ/.env.XXXXXX")"
trap 'rm -f "$TEMPORAL"' EXIT
while IFS= read -r linea || [[ -n "$linea" ]]; do
  linea="${linea%$'\r'}"
  clave="${linea%%=*}"
  if [[ "$linea" == *=* ]] && valor="$(valor_para "$clave")"; then
    printf '%s=%s\n' "$clave" "$valor"
  else
    printf '%s\n' "$linea"
  fi
done < "$PLANTILLA" > "$TEMPORAL"
mv "$TEMPORAL" "$DESTINO"
trap - EXIT

echo "Se creó .env con credenciales aleatorias (permisos 600)."
echo "Usuarios: Node-RED y Grafana 'admin'. Consulte las contraseñas con:"
echo "  grep -E 'NR_ADMIN_PASSWORD|GRAFANA_ADMIN_PASSWORD' .env"
