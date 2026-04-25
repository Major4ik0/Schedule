from flask import Flask, render_template, session
import os
from datetime import timedelta
from ai_model.ml_recommender import update_recommender_async
from apscheduler.schedulers.background import BackgroundScheduler
from api import init_app

app = Flask(__name__)
app.permanent_session_lifetime = timedelta(hours=24)

# Фиксированный ключ для Docker + fallback
app.secret_key = os.environ.get('SECRET_KEY', 'docker-fixed-secret-key-123456789')

# Настройки сессии для Docker
app.config.update(
    PERMANENT_SESSION_LIFETIME=timedelta(hours=24),
    SESSION_COOKIE_SECURE=False,  # False для HTTP в Docker
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_REFRESH_EACH_REQUEST=True
)

init_app(app)

# Планировщик для автоматического обновления модели
scheduler = BackgroundScheduler()


def scheduled_training():
    """Плановое обучение модели"""
    from datetime import datetime
    from db.database import DataBase

    db = DataBase()
    current_year = datetime.now().year
    current_month = datetime.now().month

    # Определяем текущий учебный год
    if current_month >= 9:
        study_year_start = current_year
    else:
        study_year_start = current_year - 1

    # Получаем ID учебного года
    query = "SELECT school_year FROM studyyears WHERE number = %s OR name LIKE %s"
    result = db.fetchone(query, (str(study_year_start), f"%{study_year_start}%"))

    if result:
        study_year_id = result['school_year']
        print(f"Запуск планового обучения модели для учебного года {study_year_id}")
        update_recommender_async(study_year_id)


# Запускаем обучение раз в сутки
# scheduler.add_job(scheduled_training, 'interval', hours=24)
# scheduler.start()

# Также запускаем обучение при старте приложения
# scheduled_training()


@app.route('/')
def index():
    session.pop('is_admin', None)
    return render_template('index.html')


@app.route('/user')
def user():
    is_admin = session.get('is_admin', False)
    return render_template('sh.html', is_admin=is_admin)


@app.route('/workload')
def workload():
    return render_template('workload.html')


# app.run(host='0.0.0.0', port=5123, debug=True)
