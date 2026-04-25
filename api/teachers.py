# -*- coding: utf-8 -*-
from flask import Blueprint, jsonify

from db.database import DataBase

api_th = Blueprint('api', __name__, url_prefix='/api')

@api_th.route('/getTeachers', methods=['GET'])
def get_teachers():
    """Получение списка всех преподавателей"""
    try:
        db = DataBase()
        query = """
       SELECT DISTINCT
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name, 
            cp.id_pmk as category,
            cp.mid as id
        FROM people AS p
        JOIN cathedra_personnel AS cp ON p.mid = cp.mid
        WHERE cp.id_pmk = 1

        UNION

        SELECT DISTINCT
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            cp.id_pmk as category,
            cp.mid as id
        FROM people AS p
        JOIN cathedra_personnel AS cp ON p.mid = cp.mid
        WHERE cp.id_pmk = 2

        ORDER BY full_name
        """
        # Форматируем для фронтенда
        return jsonify({teacher['full_name']: {"category": teacher['category'], "id": teacher['id']} for teacher in
                        db.fetchall(query)})

    except Exception as e:
        print(f"Error in getTeachers: {e}")
        return jsonify({'error': str(e)}), 500

@api_th.route('/teacher/<teacher_name>')
def get_teacher_info(teacher_name):
    palette = get_cached_palette(12)
    teacher_hash = hash_string(teacher_name)
    color_index = teacher_hash % len(palette)

    return jsonify({
        'teacher_name': teacher_name,
        'color': palette[color_index],
        'teacher_id': f't-{teacher_hash}',
        'color_index': color_index
    })