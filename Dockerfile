FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY app app/
COPY .env .env

# Expose FastAPI port
EXPOSE 5000

# Run FastAPI
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app.main:app"]
