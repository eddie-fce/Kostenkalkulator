# Kleiner Container für den Sync-Endpunkt (z. B. in Coolify): ca. 15–20 MB RAM, kein Webserver nötig.
FROM php:8.3-cli-alpine
WORKDIR /app
COPY api.php .
ENV KALKULATOR_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
# api.php dient als Router: jede URL (auch "/") landet im Skript.
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/app", "/app/api.php"]
