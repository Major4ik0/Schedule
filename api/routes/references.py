# -*- coding: utf-8 -*-
from flask import jsonify, request
from api import api_bp
from api.utils.database import EntityDAO, PeriodDAO
from api.utils.helpers import format_period_time, extract_pair_number
from api.utils.decorators import handle_db_errors, require_query_params
from api.schedule_utils import DataBase


@api_bp.route('/getDisciplines', methods=['GET'])
@handle_db_errors
def get_disciplines():
    """Получение списка дисциплин"""
    db = DataBase()
    disciplines = db.fetchall("SELECT cid AS id, alias, title FROM courses ORDER BY alias, title")
    return jsonify(disciplines)


@api_bp.route('/getClassrooms', methods=['GET'])
@handle_db_errors
def get_classrooms():
    """Получение списка аудиторий"""
    db = DataBase()
    classrooms = db.fetchall("SELECT rid AS id, short_name FROM rooms ORDER BY short_name")
    return jsonify(classrooms)


@api_bp.route('/getLessonTypes', methods=['GET'])
@handle_db_errors
def get_lesson_types():
    """Получение списка типов занятий"""
    db = DataBase()
    lesson_types = db.fetchall("SELECT typeid AS id, alias FROM eventtools ORDER BY alias")
    return jsonify(lesson_types)


@api_bp.route('/getGroups', methods=['GET'])
@handle_db_errors
def get_groups():
    """Получение списка групп"""
    db = DataBase()
    groups = db.fetchall("SELECT gid AS id, name, idcathedra, idfaculty FROM groupname ORDER BY name")
    return jsonify(groups)


@api_bp.route('/getFaculty', methods=['GET'])
@handle_db_errors
def get_faculty():
    """Получение факультетов"""
    db = DataBase()
    faculty = db.fetchall('SELECT idfaculty, "shortName", faculty FROM fuculty')
    return jsonify(faculty)


@api_bp.route('/getPeriodsForYear', methods=['GET'])
@handle_db_errors
@require_query_params('year')
def get_periods_for_year():
    """Получение расписания пар для указанного учебного года"""
    db = DataBase()
    study_year = int(request.args.get('year'))

    query = "SELECT syid FROM studyyears WHERE school_year = %s"
    year_result = db.fetchone(query, (study_year,))

    if not year_result:
        year_result = db.fetchone("SELECT syid FROM studyyears ORDER BY syid DESC LIMIT 1")

    periods = PeriodDAO.get_periods_by_year(db, year_result['syid'])

    formatted = []
    for i, period in enumerate(periods):
        time_range = format_period_time(period['starttime'], period['stoptime'])
        pair_number = extract_pair_number(period['short_time']) or (i + 1)

        formatted.append({
            'id': period['lid'], 'name': period['name'], 'short_name': period['short_time'],
            'time_range': time_range, 'pair_number': pair_number,
            'start_minutes': period['starttime'], 'stop_minutes': period['stoptime'],
            'index': i
        })

    return jsonify({'study_year': study_year, 's_year_id': year_result['syid'], 'periods': formatted})


@api_bp.route('/getPeriodsForDate', methods=['GET'])
@handle_db_errors
@require_query_params('date')
def get_periods_for_date():
    """Получение расписания пар для конкретной даты"""
    from datetime import datetime
    from ..utils.helpers import get_academic_year_info

    db = DataBase()
    date_obj = datetime.strptime(request.args.get('date'), '%Y-%m-%d')
    year_info = get_academic_year_info(date_obj)

    from ..utils.database import ScheduleDAO
    s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

    if not s_year_id:
        return jsonify({'error': 'Study year not found'}), 404

    periods = PeriodDAO.get_periods_by_year(db, s_year_id)

    formatted = []
    for i, period in enumerate(periods):
        time_range = format_period_time(period['starttime'], period['stoptime'])
        formatted.append({
            'index': i, 'pair_id': period['lid'],
            'name': period['name'], 'short_name': period['short_time'],
            'time_range': time_range,
            'display_text': f"{period['short_time']} ({time_range})"
        })

    return jsonify({'date': date_obj.strftime('%Y-%m-%d'), 'periods': formatted})


@api_bp.route('/getStudyYear', methods=['GET'])
@handle_db_errors
def get_study_year():
    """Получает текущий учебный год на основе даты"""
    from datetime import datetime
    from ..utils.helpers import get_academic_year_info
    from ..utils.database import ScheduleDAO

    db = DataBase()
    date_str = request.args.get('date')
    date_obj = datetime.strptime(date_str, '%Y-%m-%d') if date_str else datetime.now()

    year_info = get_academic_year_info(date_obj)
    study_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

    return jsonify({
        'success': True,
        'study_year': year_info['study_year_full'],
        'study_year_id': study_year_id,
        'study_year_start': year_info['study_year_start']
    })