FROM python:3.11-slim

# System deps for GDAL/GeoPandas/Fiona. build-essential is required because the
# Python GDAL binding has no generic manylinux wheel — it always compiles
# against the system libgdal.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app
COPY requirements.txt .

# requirements.txt pins gdal==3.9.1, which matches macOS/Homebrew GDAL used in
# local dev. Debian's apt package is usually an older minor version, so the
# Python binding must match whatever libgdal apt actually installed — not the
# pinned version — or the C extension build fails.
RUN pip install --no-cache-dir $(grep -vi '^gdal' requirements.txt | tr '\n' ' ') \
    && pip install --no-cache-dir "GDAL==$(gdal-config --version)"

COPY . .

EXPOSE 8000
CMD ["python", "run.py"]
