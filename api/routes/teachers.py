# -*- coding: utf-8 -*-
from flask import jsonify, request
from api import api_bp
from api.utils.decorators import handle_db_errors, require_params
from api.schedule_utils import DataBase


@api_bp.route('/getTeachers', methods=['GET'])
@handle_db_errors
def get_teachers():
    """Получение списка всех преподавателей"""
    db = DataBase()
    query = """
    SELECT DISTINCT
        p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name, 
        cp.id_pmk as category,
        cp.mid as id
    FROM people AS p
    JOIN cathedra_personnel AS cp ON p.mid = cp.mid
    WHERE cp.id_pmk IN (1, 2)
    ORDER BY full_name
    """

    teachers = db.fetchall(query)
    return jsonify({t['full_name']: {"category": t['category'], "id": t['id']} for t in teachers})
