# -*- coding: utf-8 -*-
from flask import jsonify, request
from api import api_bp
from api.utils.decorators import handle_db_errors
from api.schedule_utils import get_cached_palette, hash_string


@api_bp.route('/palette/<int:num_teachers>')
@handle_db_errors
def get_palette(num_teachers):
    palette = get_cached_palette(num_teachers)
    return jsonify({'palette': palette, 'count': len(palette)})


@api_bp.route('/teacher/<teacher_name>')
@handle_db_errors
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


@api_bp.route('/teachers-colors', methods=['POST'])
@handle_db_errors
def get_teachers_colors():
    """Эндпоинт для получения цветов для нескольких преподавателей сразу"""
    data = request.get_json()
    teachers = data.get('teachers', [])
    num_colors = data.get('palette_size', 12)

    palette = get_cached_palette(num_colors)
    result = {}

    for teacher in teachers:
        teacher_hash = hash_string(teacher)
        color_index = teacher_hash % len(palette)
        result[teacher] = {
            'color': palette[color_index],
            'teacher_id': f't-{teacher_hash}'
        }

    return jsonify(result)


@api_bp.route('/getColorAtGroup/<path:group_name>', methods=['GET'])
@handle_db_errors
def get_color_at_group(group_name):
    """Получение цвета по группе"""
    from api.schedule_utils import DataBase

    db = DataBase()
    group = db.fetchone("SELECT idfaculty FROM groupname WHERE name = %s", (group_name,))

    colors = {
        37: "#F19CBB", 41: "#F19CBB", 42: "#396a42",
        40: "#E5BE01", 39: "#42AAFF",
    }

    return jsonify(colors.get(group['idfaculty'] if group else None, "#000000"))