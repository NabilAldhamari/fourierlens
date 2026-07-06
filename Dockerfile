# FourierLens container. The frontend bundle is committed under
# src/fourierlens/webui, so this image needs no Node toolchain.
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY samples ./samples

RUN pip install --no-cache-dir .

EXPOSE 8321
# bind to all interfaces inside the container; don't try to open a browser
CMD ["fourierlens", "serve", "--host", "0.0.0.0", "--port", "8321", "--no-browser"]
