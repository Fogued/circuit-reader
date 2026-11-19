# Live API of circuit-reader for a Hugging Face Space (Docker SDK, free CPU hardware).
# The build context is assembled by .github/workflows/space.yml: this file, circuit_reader.py, backend/,
# results/ and the two requirements files.
FROM python:3.12-slim

# opencv (pulled in by ultralytics) needs these shared libraries
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Spaces run the container as uid 1000
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app

# CPU-only torch first (the default wheel bundles CUDA and is several GB), then the pinned requirements:
# torch==2.11.0 in requirements.txt is already satisfied by 2.11.0+cpu.
COPY requirements.txt backend-requirements.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.11.0+cpu \
 && pip install -r backend-requirements.txt -r requirements.txt huggingface_hub==0.36.2

# Bake the trained weights into the image at a fixed revision, so a cold start does not download 1.3 GB.
ARG MODEL_REPO=Fogued/circuit-reader-models
ARG MODEL_REVISION=6f673277653695be55fb2485b60bd3bd28aa9824
RUN python -c "from huggingface_hub import snapshot_download; \
snapshot_download('${MODEL_REPO}', revision='${MODEL_REVISION}', local_dir='/models')" \
 && test -f /models/best.pt && test -f /models/trocr_values/config.json

COPY --chown=user circuit_reader.py ./
COPY --chown=user backend ./backend
COPY --chown=user results ./results

USER user
ENV CIRCUIT_DETECTOR=/models/best.pt \
    CIRCUIT_READER=/models/trocr_values \
    CORS_ORIGINS=https://fogued.github.io \
    MAX_CONCURRENT_READS=1
EXPOSE 7860
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
