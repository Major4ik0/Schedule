# -*- coding: utf-8 -*-
from functools import wraps
from flask import jsonify, request


def handle_db_errors(f):
    """Декоратор для обработки ошибок БД"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            print(f"Error in {f.__name__}: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500

    return decorated_function


def require_params(*params, source='json'):
    """Декоратор для проверки обязательных параметров"""

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if source == 'json':
                data = request.get_json() or {}
            else:
                data = request.args

            missing = []
            for p in params:
                value = data.get(p)
                # Проверяем наличие поля
                if p not in data:
                    missing.append(p)
                # Для числовых полей (которые могут быть 0) проверяем только на None
                elif p in ['pair_index', 'typeid', 'rid', 'gid', 'cid', 'period_id', 'day_of_week', 'schedule_id',
                           'exclude_teacher_id', 'cathedra_id', 'group_id', 'study_year_id']:
                    if value is None:
                        missing.append(p)
                # Для строковых полей проверяем на пустоту
                else:
                    if value is None or (isinstance(value, str) and not value.strip()):
                        missing.append(p)

            if missing:
                return jsonify({'error': f'Missing required fields: {missing}'}), 400
            return f(*args, **kwargs)

        return decorated_function

    return decorator


def require_query_params(*params):
    """Декоратор для проверки обязательных query параметров"""
    return require_params(*params, source='query')