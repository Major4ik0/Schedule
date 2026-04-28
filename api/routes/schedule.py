# -*- coding: utf-8 -*-
from datetime import datetime
from flask import jsonify, request
from api import api_bp
from api.utils.database import TeacherDAO, ScheduleDAO, PeriodDAO, EntityDAO
from api.utils.helpers import get_academic_year_info, get_month_bounds
from api.utils.decorators import handle_db_errors, require_params, require_query_params
from api.schedule_utils import DataBase, format_schedule_data


@api_bp.route('/getsSchedule', methods=['GET'])
@handle_db_errors
@require_query_params('month', 'teachers')
def get_schedules():
    """Получение расписания"""
    db = DataBase()
    month_str = request.args.get('month')
    teachers_str = request.args.get('teachers')

    year, month = map(int, month_str.split('-'))
    first_day, last_day = get_month_bounds(year, month)
    teacher_ids = list(map(int, teachers_str.split(',')))

    # Получаем преподавателей
    teachers_data = TeacherDAO.get_by_ids(db, teacher_ids)
    teacher_names = [t['full_name'] for t in teachers_data]
    teacher_mids = [t['mid'] for t in teachers_data]

    # Определяем учебный год
    date_obj = datetime(year, month, 1)
    year_info = get_academic_year_info(date_obj)
    study_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

    if not study_year_id:
        return jsonify({'error': 'Study year not found'}), 404

    # Основной запрос
    query = _build_schedule_query()
    params = (
        year_info['academic_year_start'],
        study_year_id,
        year, month, year, month,
        teacher_mids,
        first_day, last_day
    )

    data = db.fetchall(query, params)
    return jsonify(format_schedule_data(data))


def _build_schedule_query():
    """Строит SQL запрос для расписания с агрегацией множественных значений"""
    return """
    WITH schedule_variants AS (
        SELECT 
            nsv.sh_var_id, nsv.sh_var_name, nsv.s_year_id,
            CASE 
                WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                    TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                    DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                ELSE NULL
            END as week_start_date
        FROM nnz_schedule_variants nsv
        WHERE nsv.sh_var_name IS NOT NULL AND nsv.s_year_id = %s
    ),
    filtered_variants AS (
        SELECT sv.* FROM schedule_variants sv
        WHERE sv.week_start_date IS NOT NULL
        AND (
            (EXTRACT(YEAR FROM sv.week_start_date) = %s AND EXTRACT(MONTH FROM sv.week_start_date) = %s)
            OR (EXTRACT(YEAR FROM sv.week_start_date + INTERVAL '6 days') = %s AND EXTRACT(MONTH FROM sv.week_start_date + INTERVAL '6 days') = %s)
        )
    ),
    -- Получаем всех преподавателей для каждой записи
    schedule_with_teachers AS (
        SELECT 
            nnz_s.sheid,
            array_agg(DISTINCT p.lastname || ' ' || p.firstname || ' ' || p.patronymic) AS all_teachers,
            array_agg(DISTINCT p.mid) AS all_teacher_mids
        FROM filtered_variants fv
        JOIN nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
        JOIN people p ON p.mid = ANY(nnz_s.teacher_mid)
        GROUP BY nnz_s.sheid
    ),
    -- Получаем все аудитории для каждой записи
    schedule_with_rooms AS (
        SELECT 
            nnz_s.sheid,
            array_agg(DISTINCT COALESCE(r.short_name, 'Ауд. не указана')) AS all_rooms,
            array_agg(DISTINCT r.rid) AS all_rids
        FROM filtered_variants fv
        JOIN nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
        LEFT JOIN rooms r ON r.rid = ANY(nnz_s.rid)
        GROUP BY nnz_s.sheid
    )
    SELECT 
        p_main.lastname || ' ' || p_main.firstname || ' ' || p_main.patronymic AS teacher_name,
        TO_CHAR(fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day', 'YYYY-MM-DD') AS event_date,
        pr.name AS period_name, 
        crs.alias AS course_name,
        COALESCE(r_main.short_name, 'Ауд. не указана') AS room_name,
        e.alias AS event_type, 
        g_main.name AS group_name,
        nnz_s.sheid AS schedule_id, 
        fv.sh_var_name,
        nnz_s.day_of_week, 
        p_main.mid as teacher_mid,
        g_main.gid, 
        crs.cid, 
        r_main.rid, 
        pr.lid, 
        nnz_s.idcathedra, 
        nnz_s.lesson_num, 
        fv.week_start_date,
        -- Массивы всех значений
        COALESCE(swt.all_teachers, ARRAY[]::text[]) AS all_teachers,
        COALESCE(swt.all_teacher_mids, ARRAY[]::integer[]) AS all_teacher_mids,
        COALESCE(swr.all_rooms, ARRAY[]::text[]) AS all_rooms,
        COALESCE(swr.all_rids, ARRAY[]::integer[]) AS all_rids
    FROM filtered_variants fv
    JOIN nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
    JOIN people p_main ON p_main.mid = nnz_s.teacher_mid[1]  -- Основной преподаватель (первый в массиве)
    JOIN courses crs ON crs.cid = nnz_s.cid
    LEFT JOIN rooms r_main ON r_main.rid = nnz_s.rid[1]  -- Основная аудитория (первая в массиве)
    JOIN eventtools e ON nnz_s.pair_type_id = e.typeid
    JOIN groupname g_main ON nnz_s.gid = g_main.gid
    JOIN periods pr ON nnz_s.period = pr.lid
    LEFT JOIN schedule_with_teachers swt ON swt.sheid = nnz_s.sheid
    LEFT JOIN schedule_with_rooms swr ON swr.sheid = nnz_s.sheid
    WHERE p_main.mid = ANY(%s)
    AND fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day' BETWEEN %s AND %s
    ORDER BY event_date, period_name
    """


@api_bp.route('/postSchedule', methods=['POST'])
@handle_db_errors
@require_params('teacher_name', 'date', 'pair_index', 'typeid', 'rid', 'gid', 'cid')
def post_schedule():
    """Добавление новой записи в расписание"""
    db = DataBase()
    data = request.get_json()

    try:
        # Получаем массивы преподавателей
        if 'teachers' in data and data['teachers']:
            teacher_mids = []
            for name in data['teachers']:
                mid = TeacherDAO.get_by_full_name(db, name)
                if mid:
                    teacher_mids.append(mid)
            if not teacher_mids:
                teacher_mids = [EntityDAO.get_id(db, 'people', 'mid',
                                                 "lastname || ' ' || firstname || ' ' || patronymic",
                                                 data['teacher_name'], 'Teacher')]
        else:
            teacher_mids = [EntityDAO.get_id(db, 'people', 'mid',
                                             "lastname || ' ' || firstname || ' ' || patronymic",
                                             data['teacher_name'], 'Teacher')]

        # Получаем массивы аудиторий
        if 'rooms' in data and data['rooms']:
            rids = [int(r) for r in data['rooms']]
        else:
            rids = [int(data['rid'])]

        # Получаем массивы групп (ВАЖНО: gid ожидает одно число, используем первое)
        if 'groups' in data and data['groups']:
            gids_array = [int(g) for g in data['groups']]
            gid = gids_array[0]  # Берем первую группу как основную
        else:
            gid = int(data['gid'])

        cid = int(data['cid'])
        pair_type_id = int(data['typeid'])
        lesson_num = int(data['lesson_num']) if data.get('lesson_num') else None

        # Получаем кафедру (от первого преподавателя)
        idcathedra = TeacherDAO.get_cathedra(db, teacher_mids[0])

        # Получаем вариант расписания
        date_obj = datetime.strptime(data['date'], '%Y-%m-%d')
        year_info = get_academic_year_info(date_obj)
        s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

        if not s_year_id:
            return jsonify({'error': 'Study year not found'}), 404

        sh_var_id = _find_schedule_variant(db, date_obj, s_year_id, year_info['academic_year_start'])
        if not sh_var_id:
            sh_var_id = _get_default_variant(db, s_year_id)

        if not sh_var_id:
            return jsonify({'error': 'No schedule variant found'}), 404

        period_id = PeriodDAO.get_by_pair_index(db, s_year_id, int(data['pair_index']))

        # Вставляем запись: gid как ОДНО число, rid и teacher_mid как массивы
        result = db.execute_returning("""
            INSERT INTO nnz_schedule (cid, rid, gid, teacher_mid, sh_var_id, period, day_of_week, pair_type_id, idcathedra, lesson_num)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING sheid
        """, (
            cid, rids, gid, teacher_mids,  # gid - одно число
            sh_var_id, period_id, date_obj.isoweekday(), pair_type_id, idcathedra, lesson_num
        ))

        if result and 'sheid' in result:
            return jsonify({
                'success': True,
                'schedule_id': result['sheid'],
                'message': 'Schedule added successfully'
            })
        else:
            return jsonify({'error': 'Failed to get schedule ID after insertion'}), 500

    except ValueError as e:
        return jsonify({'error': f'Invalid data type: {str(e)}'}), 400


def _find_schedule_variant(db, date_obj, s_year_id, academic_year_start):
    """Находит вариант расписания"""
    # Подход 1: по точной дате
    sh_var_id = ScheduleDAO.get_schedule_variant_by_date(db, date_obj, s_year_id, academic_year_start)
    if sh_var_id:
        return sh_var_id

    # Подход 2: по номеру учебной недели
    if date_obj.month >= 9:
        start_of_year = datetime(date_obj.year, 9, 1)
    else:
        start_of_year = datetime(date_obj.year - 1, 9, 1)

    study_week = ((date_obj - start_of_year).days // 7) + 1
    query = "SELECT sh_var_id FROM nnz_schedule_variants WHERE sh_var_name ILIKE %s AND s_year_id = %s LIMIT 1"
    result = db.fetchone(query, (f"%{study_week} неделя%", s_year_id))

    return result['sh_var_id'] if result else None


def _get_default_variant(db, s_year_id):
    """Получает вариант расписания по умолчанию"""
    query = "SELECT sh_var_id FROM nnz_schedule_variants WHERE s_year_id = %s ORDER BY sh_var_id LIMIT 1"
    result = db.fetchone(query, (s_year_id,))
    if not result:
        result = db.fetchone("SELECT sh_var_id FROM nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1")
    return result['sh_var_id'] if result else None


@api_bp.route('/updateSchedule', methods=['PUT'])
@handle_db_errors
@require_params('schedule_id')
def update_schedule():
    """Обновление записи расписания"""
    db = DataBase()
    data = request.get_json()
    schedule_id = int(data['schedule_id'])

    # Проверяем существование
    existing = db.fetchone("SELECT sheid FROM nnz_schedule WHERE sheid = %s", (schedule_id,))
    if not existing:
        return jsonify({'error': 'Schedule record not found'}), 404

    # Формируем UPDATE
    update_fields, params = _build_update_fields(data)
    if not update_fields:
        return jsonify({'error': 'No fields to update'}), 400

    query = f"UPDATE nnz_schedule SET {', '.join(update_fields)} WHERE sheid = %s"
    params.append(schedule_id)
    db.execute(query, tuple(params))

    return jsonify({'success': True, 'message': 'Schedule updated successfully'})


def _build_update_fields(data):
    """Строит поля для UPDATE с правильными типами данных"""
    update_fields = []
    params = []

    field_mapping = {
        'cid': ('cid', int),
        'gid': ('gid', int),
        'typeid': ('pair_type_id', int),
        'lesson_num': ('lesson_num', int)
    }

    for field, (db_field, converter) in field_mapping.items():
        if field in data and data[field] is not None:
            update_fields.append(f"{db_field} = %s")
            params.append(converter(data[field]))

    # Обработка массива комнат - преобразуем в список целых чисел
    if 'rid' in data and data['rid']:
        if isinstance(data['rid'], list):
            rid_array = [int(r) for r in data['rid']]  # Преобразуем каждый элемент в int
        else:
            rid_array = [int(data['rid'])]  # Преобразуем в int
        update_fields.append("rid = %s")
        params.append(rid_array)

    # Обработка преподавателя - преобразуем в список целых чисел
    if 'teacher_mid' in data and data['teacher_mid']:
        if isinstance(data['teacher_mid'], list):
            teacher_array = [int(t) for t in data['teacher_mid']]
        else:
            teacher_array = [int(data['teacher_mid'])]
        update_fields.append("teacher_mid = %s")
        params.append(teacher_array)

    return update_fields, params


@api_bp.route('/deleteSchedule', methods=['DELETE'])
@handle_db_errors
def delete_schedule():
    """Удаление записи расписания"""
    db = DataBase()
    schedule_id = request.args.get('schedule_id')

    if not schedule_id:
        return jsonify({'error': 'Missing schedule_id'}), 400

    existing = db.fetchone("SELECT sheid FROM nnz_schedule WHERE sheid = %s", (schedule_id,))
    if not existing:
        return jsonify({'error': 'Schedule record not found'}), 404

    db.execute("DELETE FROM nnz_schedule WHERE sheid = %s", (schedule_id,))
    return jsonify({'success': True, 'message': 'Schedule deleted successfully'})


@api_bp.route('/swapSchedule', methods=['POST'])
@handle_db_errors
@require_params('from_teacher', 'to_teacher', 'date', 'pair_index', 'schedule_id')
def swap_schedule():
    """Замена пары между преподавателями"""
    db = DataBase()
    data = request.json

    from_teacher = data['from_teacher']
    to_teacher = data['to_teacher']
    date = data['date']
    pair_index = int(data['pair_index'])
    schedule_id = int(data['schedule_id'])

    # Получаем ID преподавателей
    from_mid = TeacherDAO.get_by_full_name(db, from_teacher)
    to_mid = TeacherDAO.get_by_full_name(db, to_teacher)

    if not from_mid or not to_mid:
        return jsonify({'success': False, 'error': 'Teacher not found'}), 404

    # Получаем информацию о дате
    date_obj = datetime.strptime(date, '%Y-%m-%d')
    year_info = get_academic_year_info(date_obj)
    s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

    if not s_year_id:
        return jsonify({'success': False, 'error': 'Study year not found'}), 404

    period_id = PeriodDAO.get_by_pair_index(db, s_year_id, pair_index)

    # Получаем вариант расписания
    sh_var_id = _find_schedule_variant(db, date_obj, s_year_id, year_info['academic_year_start'])
    if not sh_var_id:
        sh_var_id = _get_default_variant(db, s_year_id)

    if not sh_var_id:
        return jsonify({'success': False, 'error': 'No schedule variant found'}), 404

    # Проверяем конфликт
    conflict = db.fetchone("""
        SELECT sheid FROM nnz_schedule
        WHERE sh_var_id = %s AND period = %s AND day_of_week = %s AND teacher_mid @> ARRAY[%s]::integer[]
        LIMIT 1
    """, (sh_var_id, period_id, date_obj.isoweekday(), to_mid))

    if conflict:
        return jsonify({
            'success': False,
            'error': f'Teacher {to_teacher} already has a pair at this time'
        }), 409

    # Обновляем запись
    new_idcathedra = TeacherDAO.get_cathedra(db, to_mid)

    # ВАЖНО: передаем массив целых чисел
    result = db.execute_returning("""
        UPDATE nnz_schedule
        SET teacher_mid = %s, idcathedra = %s, sh_var_id = %s, period = %s, day_of_week = %s
        WHERE sheid = %s RETURNING sheid
    """, ([to_mid], new_idcathedra, sh_var_id, period_id, date_obj.isoweekday(), schedule_id))

    if not result:
        return jsonify({'success': False, 'error': 'Failed to update schedule'}), 500

    return jsonify({
        'success': True,
        'message': f'Pair transferred from {from_teacher} to {to_teacher}',
        'data': {'schedule_id': schedule_id}
    })
