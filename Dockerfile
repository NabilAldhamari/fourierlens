# FourierLens container. The frontend bundle is committed under
# src/fourierlens/webui, so this image needs no Node toolchain.
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY samples ./samples

RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 10001 fourierlens

USER fourierlens

EXPOSE 8321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8321/api/health', timeout=4).status == 200 else 1)"
# bind to all interfaces inside the container; don't try to open a browser.
# Publish the port on loopback only (see README / docker-compose.yml).
CMD ["fourierlens", "serve", "--host", "0.0.0.0", "--port", "8321", "--no-browser"]
