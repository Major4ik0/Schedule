# # -*- coding: utf-8 -*-
# from .schedule import api_bp
# from .teachers import api_th
from .workload_api import workload_bp
#
#
# def init_app(app):
#     """Инициализация API blueprint"""
#     app.register_blueprint(api_bp)
#     app.register_blueprint(api_th)
#     app.register_blueprint(workload_bp)

# -*- coding: utf-8 -*-
from flask import Blueprint

# Создаем blueprint для API
api_bp = Blueprint('api', __name__, url_prefix='/api')

# Импортируем все маршруты
from api.routes import teachers, schedule, references, colors, recommendations, admin

def init_app(app):
    """Инициализация API blueprint"""
    app.register_blueprint(api_bp)
    app.register_blueprint(workload_bp)