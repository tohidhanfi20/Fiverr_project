FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8085

USER nobody

CMD ["gunicorn", "--bind", "0.0.0.0:8085", "--workers", "4", "app:app"]

