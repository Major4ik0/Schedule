FROM python:3.11-slim-bullseye

# Установите переменные окружения
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV SECRET_KEY=fixed-docker-secret-key-123456789
ENV PYTHONUNBUFFERED=1

ENV TZ=Europe/Moscow
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# Установка системных зависимостей для numpy/scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --root-user-action=ignore --upgrade pip --no-warn-script-location

COPY requirements.txt .

# Установка Python зависимостей
RUN pip install --root-user-action=ignore --no-cache-dir --no-warn-script-location -r requirements.txt && \
    pip install --root-user-action=ignore --no-cache-dir --no-warn-script-location gunicorn==21.2.0

# ЭТА КОМАНДА ДОЛЖНА БЫТЬ ОТДЕЛЬНО!
COPY . .

# Создаем директорию для модели
RUN mkdir -p /app/models

EXPOSE 5123

CMD ["gunicorn", "--bind", "0.0.0.0:5123", "main:app", "--workers", "4"]