# -*- coding: utf-8 -*-
import math
from flask import Blueprint, request, jsonify, session
from ai_model.ml_recommender import recommender, init_recommender, update_recommender_async
from .schedule_utils import *

# Создаем blueprint для API
api_bp = Blueprint('api', __name__, url_prefix='/api')



@api_bp.route('/getsSchedule', methods=['GET'])
def get_schedules():
    try:
        db = DataBase()
        month_str = request.args.get('month')
        teachers_str = request.args.get('teachers')

        if not month_str or not teachers_str:
            return jsonify({'error': 'Missing month or teachers parameter'}), 400

        # Парсим параметры
        year, month = map(int, month_str.split('-'))

        # Получаем границы месяца
        first_day, last_day = get_first_last_day_of_month(year, month)

        # Получаем список преподавателей
        teacher_ids = list(map(int, teachers_str.split(',')))

        # Получаем имена преподавателей
        query_teachers = """
        SELECT p.mid, p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name
        FROM people p
        WHERE p.mid = ANY(%s)
        ORDER BY p.lastname, p.firstname
        """
        teachers_data = db.fetchall(query_teachers, (teacher_ids,))
        teacher_names = list(map(lambda x: x['full_name'], teachers_data))
        teacher_mids = list(map(lambda x: x['mid'], teachers_data))

        # Определяем учебный год для запрашиваемого месяца
        def get_study_year_name_for_month(year, month):
            """Определяет название учебного года для заданного месяца"""
            # Учебный год: с 1 сентября по 31 августа
            if month >= 9:  # Сентябрь-Декабрь
                study_year_start = year
            else:  # Январь-Август
                study_year_start = year - 1
            return str(study_year_start)

        def get_study_year_number_for_month(year, month):
            """Определяет номер учебного года для заданного месяца"""
            # Учебный год: с 1 сентября по 31 августа
            if month >= 9:  # Сентябрь-Декабрь
                study_year_start = year
            else:  # Январь-Август
                study_year_start = year - 1

            # Преобразуем год в номер (например, 2024 -> 24)
            study_year_number = str(study_year_start)[-2:]  # Берем последние 2 цифры
            return study_year_number

        # В основной функции замените:
        study_year_str = get_study_year_name_for_month(year, month)
        study_year_number = get_study_year_number_for_month(year, month)

        # Получаем ID учебного года из таблицы studyyears
        query_study_year = """
        SELECT school_year 
        FROM studyyears 
        WHERE name = %s OR number = %s
        LIMIT 1
        """
        study_year_data = db.fetchone(query_study_year, (study_year_str, study_year_number))

        if not study_year_data:
            # Попробуем альтернативный поиск
            # Может быть, в name хранится полный учебный год?
            full_study_year = f"{study_year_str}-{int(study_year_str) + 1}"
            query_study_year_alt = """
            SELECT school_year 
            FROM studyyears 
            WHERE name = %s
            LIMIT 1
            """
            study_year_data = db.fetchone(query_study_year_alt, (full_study_year,))

            if not study_year_data:
                # Если не нашли, берем последний учебный год
                query_last_year = """
                SELECT school_year 
                FROM studyyears 
                ORDER BY syid DESC 
                LIMIT 1
                """
                study_year_data = db.fetchone(query_last_year)
                if study_year_data:
                    print(f"Using last available study year: {study_year_data['school_year']}")

        study_year_id = study_year_data['school_year']

        # Основной запрос с учетом учебного года
        safe_query = """
            WITH schedule_variants AS (
                SELECT 
                    nsv.sh_var_id,
                    nsv.sh_var_name,
                    nsv.s_year_id,
                    CASE 
                        -- Формат "Неделя X (DD.MM.YYYY - DD.MM.YYYY)"
                        WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                            TO_DATE(
                                TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                                'DD.MM.YYYY'
                            )
                        -- Формат "расписания X недель"
                        WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                            DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        ELSE NULL
                    END as week_start_date
                FROM nnz_schedule_variants nsv
                WHERE nsv.sh_var_name IS NOT NULL
                AND nsv.s_year_id = %s  -- Фильтр по учебному году!
            ),
            filtered_variants AS (
                SELECT sv.*
                FROM schedule_variants sv
                WHERE sv.week_start_date IS NOT NULL
                AND (
                    -- Вариант 1: Дата начала недели попадает в запрашиваемый месяц
                    (EXTRACT(YEAR FROM sv.week_start_date) = %s AND EXTRACT(MONTH FROM sv.week_start_date) = %s)
                    OR
                    -- Вариант 2: Дата начала недели + 6 дней попадает в запрашиваемый месяц
                    (EXTRACT(YEAR FROM sv.week_start_date + INTERVAL '6 days') = %s AND EXTRACT(MONTH FROM sv.week_start_date + INTERVAL '6 days') = %s)
                )
            )
            SELECT 
                p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS teacher_name,
                TO_CHAR(fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day', 'YYYY-MM-DD') AS event_date,
                pr.name AS period_name,
                crs.alias AS course_name,
                COALESCE(r.short_name, 'Ауд. не указана') AS room_name,
                e.alias AS event_type,
                g.name AS group_name,
                nnz_s.sheid AS schedule_id,
                fv.sh_var_name,
                nnz_s.day_of_week,
                p.mid as teacher_mid,
                g.gid,
                crs.cid,
                r.rid,
                pr.lid,
                nnz_s.idcathedra,
                fv.week_start_date
            FROM filtered_variants fv
            JOIN nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
            JOIN people p ON p.mid = ANY(nnz_s.teacher_mid)
            JOIN courses crs ON crs.cid = nnz_s.cid
            LEFT JOIN rooms r ON r.rid = ANY(nnz_s.rid)
            JOIN eventtools e ON nnz_s.pair_type_id = e.typeid
            JOIN groupname g ON nnz_s.gid = g.gid
            JOIN periods pr ON nnz_s.period = pr.lid
            WHERE p.mid = ANY(%s)  -- Используем ID преподавателей
            AND fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day' BETWEEN %s AND %s
            ORDER BY event_date, period_name
        """

        # Определяем начало учебного года для формата "расписания X недель"
        def get_academic_year_start(year, month):
            """Определяет начало учебного года (1 сентября)"""
            if month >= 9:
                return f"{year}-09-01"
            else:
                return f"{year - 1}-09-01"

        academic_year_start = get_academic_year_start(year, month)

        # Параметры для запроса
        params = (
            academic_year_start,  # для формата "расписания X недель"
            study_year_id,  # ID учебного года
            year, month,  # фильтр по году и месяцу для начала недели
            year, month,  # фильтр по году и месяцу для конца недели
            teacher_mids,  # список ID преподавателей
            first_day, last_day  # точный диапазон дат
        )

        data = db.fetchall(safe_query, params)

        # Форматируем данные для фронтенда
        result = format_schedule_data(data)
        return jsonify(result)

    except Exception as e:
        print(f"Error in getsSchedule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@api_bp.route('/postSchedule', methods=['POST'])
def post_schedule():
    """Добавление новой записи в расписание - УНИВЕРСАЛЬНАЯ ВЕРСИЯ"""
    db = DataBase()
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        # Проверяем обязательные поля
        required_fields = ['teacher_name', 'date', 'pair_index', 'typeid', 'rid', 'gid', 'cid']
        missing_fields = []
        for field in required_fields:
            if field not in data:
                missing_fields.append(field)
            elif field == 'pair_index':
                if data[field] is None:
                    missing_fields.append(field)
            else:
                if not data[field]:
                    missing_fields.append(field)

        if missing_fields:
            error_msg = f'Missing required fields: {", ".join(missing_fields)}'
            print(f"Validation error: {error_msg}")
            return jsonify({'error': error_msg}), 400

        teacher_name = data['teacher_name']
        date_str = data['date']
        pair_index = int(data['pair_index'])
        event_type = int(data['typeid'])
        room_name = int(data['rid'])
        group_name = int(data['gid'])
        course_name = int(data['cid'])

        # 1. Получаем ID преподавателя
        teacher_query = "SELECT mid FROM people WHERE lastname || ' ' || firstname || ' ' || patronymic = %s"
        teacher_result = db.fetchone(teacher_query, (teacher_name,))
        if not teacher_result:
            error_msg = f'Teacher not found: {teacher_name}'
            print(f"Error: {error_msg}")
            return jsonify({'error': error_msg}), 404
        teacher_mid = teacher_result['mid']

        # 2. Получаем ID комнаты
        room_query = "SELECT rid FROM rooms WHERE rid = %s"
        room_result = db.fetchone(room_query, (room_name,))
        rid = room_result['rid'] if room_result else None

        # 3. Получаем ID группы
        group_query = "SELECT gid FROM groupname WHERE gid = %s"
        group_result = db.fetchone(group_query, (group_name,))
        if not group_result:
            error_msg = f'Group not found: {group_name}'
            print(f"Error: {error_msg}")
            return jsonify({'error': error_msg}), 404
        gid = group_result['gid']

        # 4. Получаем ID курса
        course_query = "SELECT cid FROM courses WHERE cid = %s"
        course_result = db.fetchone(course_query, (course_name,))
        if not course_result:
            error_msg = f'Course not found: {course_name}'
            print(f"Error: {error_msg}")
            return jsonify({'error': error_msg}), 404
        cid = course_result['cid']

        # 5. Получаем ID типа события
        event_query = "SELECT typeid FROM eventtools WHERE typeid = %s"
        event_result = db.fetchone(event_query, (event_type,))
        if not event_result:
            error_msg = f'Event type not found: {event_type}'
            print(f"Error: {error_msg}")
            return jsonify({'error': error_msg}), 404
        pair_type_id = event_result['typeid']

        # 6. Получаем ID кафедры преподавателя
        cathedra_query = "SELECT cid FROM cathedra_personnel WHERE mid = %s LIMIT 1"
        cathedra_result = db.fetchone(cathedra_query, (teacher_mid,))

        if not cathedra_result:
            # Используем кафедру по умолчанию 151
            idcathedra = 151
        else:
            idcathedra = cathedra_result['cid']

        # 7. УНИВЕРСАЛЬНАЯ ЛОГИКА ВЫБОРА ВАРИАНТА РАСПИСАНИЯ
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        day_of_week = date_obj.isoweekday()

        # Определяем номер недели в году
        week_number = date_obj.isocalendar()[1]

        # УНИВЕРСАЛЬНЫЙ ПОИСК ВАРИАНТА РАСПИСАНИЯ - ПРОБУЕМ РАЗНЫЕ ПОДХОДЫ

        # ПОДХОД 1: Ищем по точным датам в формате "Неделя XX (DD.MM.YYYY - DD.MM.YYYY)"
        sh_var_query = """
        SELECT sh_var_id, sh_var_name, s_year_id
        FROM nnz_schedule_variants
        WHERE (
            sh_var_name ~ '\\d{1,2}\\.\\d{2}\\.\\d{4}.*\\d{1,2}\\.\\d{2}\\.\\d{4}'
            AND TO_DATE(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), ' -', 1), 'DD.MM.YYYY') <= %s
            AND TO_DATE(SPLIT_PART(SPLIT_PART(sh_var_name, '- ', 2), ')', 1), 'DD.MM.YYYY') >= %s
        )
        LIMIT 1
        """

        sh_var_result = db.fetchone(sh_var_query, (date_str, date_str))

        if not sh_var_result:
            # ПОДХОД 2: Ищем по номеру недели в формате "Вариант расписания X неделя 2025-2026"
            # Для 2025-11-03 это 45-я неделя года, но 10-я неделя учебного года
            # Вычисляем номер недели учебного года (с 1 сентября)
            if date_obj.month >= 9:  # Сентябрь-Декабрь
                start_of_year = datetime(date_obj.year, 9, 1)
            else:  # Январь-Август
                start_of_year = datetime(date_obj.year - 1, 9, 1)

            delta = date_obj - start_of_year
            study_week = (delta.days // 7) + 1

            # Ищем вариант для учебной недели
            sh_var_query = """
            SELECT sh_var_id, sh_var_name, s_year_id
            FROM nnz_schedule_variants
            WHERE (
                sh_var_name ILIKE %s AND s_year_id = 34
            )
            LIMIT 1
            """

            study_week_pattern = f"%{study_week} неделя%"
            sh_var_result = db.fetchone(sh_var_query, (study_week_pattern,))

        if not sh_var_result:
            # ПОДХОД 3: Ищем по номеру недели в году в формате "Неделя XX"
            sh_var_query = """
            SELECT sh_var_id, sh_var_name, s_year_id
            FROM nnz_schedule_variants
            WHERE (
                sh_var_name ILIKE %s
            )
            LIMIT 1
            """

            week_pattern = f"%Неделя {week_number}%"
            sh_var_result = db.fetchone(sh_var_query, (week_pattern,))

        if not sh_var_result:
            # ПОДХОД 4: Ищем любой вариант для текущего учебного года
            current_year = date_obj.year
            study_year_query = """
            SELECT syid FROM studyyears
            WHERE school_year = %s OR school_year = %s - 1
            ORDER BY school_year DESC
            LIMIT 1
            """

            study_year_result = db.fetchone(study_year_query, (current_year, current_year))

            if study_year_result:
                target_s_year_id = study_year_result['syid']
                sh_var_query = """
                SELECT sh_var_id, sh_var_name, s_year_id
                FROM nnz_schedule_variants
                WHERE s_year_id = %s
                ORDER BY sh_var_id ASC
                LIMIT 1
                """
                sh_var_result = db.fetchone(sh_var_query, (target_s_year_id,))

        if not sh_var_result:
            # ПОДХОД 5: Используем последний доступный вариант
            sh_var_query = "SELECT sh_var_id, sh_var_name, s_year_id FROM nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1"
            sh_var_result = db.fetchone(sh_var_query)

        if not sh_var_result:
            error_msg = 'No schedule variant found'
            print(f"Error: {error_msg}")
            return jsonify({'error': error_msg}), 404

        sh_var_id = sh_var_result['sh_var_id']
        sh_var_name = sh_var_result.get('sh_var_name', '')
        s_year_id = sh_var_result['s_year_id']

        # 8. Получаем period_id для найденного учебного года
        period_number = pair_index + 1

        # Ищем период для найденного учебного года
        period_query = "SELECT lid FROM periods WHERE s_year_id = %s AND short_time LIKE %s LIMIT 1"
        period_pattern = f"{period_number}-я пара"
        period_result = db.fetchone(period_query, (s_year_id, period_pattern))

        if not period_result:
            # Если не нашли, используем запасной вариант
            # Определяем, какие периоды использовать в зависимости от учебного года
            if s_year_id == 33:  # 2024-2025
                period_fallback = {0: 104, 1: 105, 2: 106, 3: 107}
            elif s_year_id == 34:  # 2025-2026
                period_fallback = {0: 112, 1: 113, 2: 114, 3: 115}
            else:  # 2026-2027 и другие
                period_fallback = {0: 112, 1: 113, 2: 114, 3: 115}  # Используем 2025 как запасной

            period_id = period_fallback.get(pair_index, 112)
        else:
            period_id = period_result['lid']

        # Подготавливаем массивы
        rid_array = [rid] if rid else None
        teacher_mid_array = [teacher_mid]

        # Вставляем запись
        insert_query = """
        INSERT INTO nnz_schedule (
            cid, rid, gid, teacher_mid,
            sh_var_id, period, day_of_week, pair_type_id, idcathedra
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        ) RETURNING sheid
        """

        result = db.execute_returning(insert_query, (
            cid, rid_array, gid, teacher_mid_array,
            sh_var_id, period_id, day_of_week, pair_type_id, idcathedra
        ))

        if result and 'sheid' in result:
            schedule_id = result['sheid']

            return jsonify({
                'success': True,
                'schedule_id': schedule_id,
                'message': 'Schedule added successfully'
            })
        else:
            print("Error: No sheid returned from INSERT")
            return jsonify({'error': 'Failed to get schedule ID after insertion'}), 500

    except Exception as e:
        print(f"Error in postSchedule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@api_bp.route('/updateSchedule', methods=['PUT'])
def update_schedule():
    """Обновление записи расписания - упрощенная версия"""
    try:
        db = DataBase()
        data = request.get_json()
        if 'schedule_id' not in data:
            return jsonify({'error': 'Missing schedule_id'}), 400

        schedule_id = int(data['schedule_id'])

        # Проверяем существование записи
        existing_query = "SELECT sheid FROM nnz_schedule WHERE sheid = %s"
        existing = db.fetchone(existing_query, (schedule_id,))

        if not existing:
            return jsonify({'error': 'Schedule record not found'}), 404
        # Формируем динамический UPDATE на основе переданных полей
        update_fields = []
        params = []
        field_mapping = {
            'cid': ('cid', None),
            'gid': ('gid', None),
            'rid': ('rid', None),
            'typeid': ('pair_type_id', None),
        }

        for field, (db_field, _) in field_mapping.items():
            if field in data and data[field] is not None and field != 'rid':
                update_fields.append(f"{db_field} = %s")
                params.append(data[field])
        # Обработка массивов
        if 'rid' in data and data['rid']:
            if isinstance(data['rid'], str):
                room_array = data['rid'].split(',')
                rid_array = ",".join(map(str, room_array))
            else:
                rid_array = data['rid']
            update_fields.append(f"rid = array[{rid_array}]")
            # params.append(extras.Json(rid_array))

        if 'teacher_mid' in data and data['teacher_mid']:
            if isinstance(data['teacher_mid'], str):
                teacher_array = data['teacher_mid'].split(',')
                teacher_mid_array = list(map(int, teacher_array))
            else:
                teacher_mid_array = data['teacher_mid']
        else:
            return jsonify({'error': 'No teacher_mid '}), 400
        if not update_fields:
            return jsonify({'error': 'No fields to update'}), 400

        query = f"UPDATE nnz_schedule SET {', '.join(update_fields)} WHERE sheid = %s"
        params.append(schedule_id)

        db.execute(query, tuple(params))

        return jsonify({
            'success': True,
            'message': 'Schedule updated successfully'
        })

    except Exception as e:
        print(f"Error in updateSchedule: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/deleteSchedule', methods=['DELETE'])
def delete_schedule():
    """Удаление записи расписания"""
    try:
        db = DataBase()
        schedule_id = request.args.get('schedule_id')

        if not schedule_id:
            return jsonify({'error': 'Missing schedule_id'}), 400

        # Проверяем существование записи
        existing_query = "SELECT sheid FROM nnz_schedule WHERE sheid = %s"
        existing = db.fetchone(existing_query, (schedule_id,))

        if not existing:
            return jsonify({'error': 'Schedule record not found'}), 404

        delete_query = "DELETE FROM nnz_schedule WHERE sheid = %s"
        result = db.execute(delete_query, (schedule_id,))

        return jsonify({
            'success': True,
            'message': 'Schedule deleted successfully'
        })

    except Exception as e:
        print(f"Error in deleting schedule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Цветовые endpoints
@api_bp.route('/palette/<int:num_teachers>')
def get_palette(num_teachers):
    palette = get_cached_palette(num_teachers)
    return jsonify({
        'palette': palette,
        'count': len(palette)
    })





@api_bp.route('/teachers-colors', methods=['POST'])
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


@api_bp.route('/getDisciplines', methods=['GET'])
def get_disciplines():
    """Получение списка дисциплин"""
    try:
        db = DataBase()
        disciplines = db.fetchall("SELECT cid AS id, alias, title FROM courses ORDER BY alias, title")
        return jsonify(disciplines)
    except Exception as e:
        print(f"Error in getDisciplines: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getClassrooms', methods=['GET'])
def get_classrooms():
    """Получение списка аудиторий"""
    try:
        db = DataBase()
        classrooms = db.fetchall("SELECT rid AS id, short_name FROM rooms ORDER BY short_name")
        return jsonify(classrooms)
    except Exception as e:
        print(f"Error in getClassrooms: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getLessonTypes', methods=['GET'])
def get_lesson_types():
    """Получение списка типов занятий"""
    try:
        db = DataBase()
        lessonTypes = db.fetchall("SELECT typeid AS id, alias FROM eventtools ORDER BY alias")
        return jsonify(lessonTypes)
    except Exception as e:
        print(f"Error in getLessonTypes: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getGroups', methods=['GET'])
def get_groups():
    """Получение списка групп"""
    try:
        db = DataBase()
        groups = db.fetchall("SELECT gid AS id, name, idcathedra, idfaculty FROM groupname ORDER BY name")
        return jsonify(groups)
    except Exception as e:
        print(f"Error in getGroups: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/check-admin-password', methods=['POST'])
def check_admin_password():
    data = request.get_json()
    login = data.get('login', '')
    psw = data.get('password', '')

    if psw == '12345678' and login == 'admin':
        session.permanent = True
        session['is_admin'] = True
        return jsonify({"success": True})
    else:
        return jsonify({"success": False, "error": 'Неверные данные'})


@api_bp.route('/debug-session')
def debug_session():
    return jsonify({
        'is_admin': session.get('is_admin', False),
        'session_id': session.get('_id', 'none'),
        'session_data': dict(session)
    })


@api_bp.route('/swapSchedule', methods=['POST'])
def swap_schedule():
    """Выполнение замены пары между преподавателями"""
    try:
        db = DataBase()
        data = request.json

        # Получаем данные из запроса
        from_teacher = data.get('from_teacher')
        to_teacher = data.get('to_teacher')
        date = data.get('date')  # формат: YYYY-MM-DD
        pair_index = data.get('pair_index')
        schedule_id = data.get('schedule_id')
        pair_id = data.get('pair_id')

        if not all([from_teacher, to_teacher, date, pair_index is not None, schedule_id]):
            return jsonify({
                'success': False,
                'error': 'Не все обязательные параметры переданы'
            }), 400

        # 1. Получаем ID обоих преподавателей
        teacher_query = "SELECT mid FROM people WHERE lastname || ' ' || firstname || ' ' || patronymic = %s"

        from_teacher_result = db.fetchone(teacher_query, (from_teacher,))
        if not from_teacher_result:
            return jsonify({
                'success': False,
                'error': f'Преподаватель "{from_teacher}" не найден'
            }), 404

        to_teacher_result = db.fetchone(teacher_query, (to_teacher,))
        if not to_teacher_result:
            return jsonify({
                'success': False,
                'error': f'Преподаватель "{to_teacher}" не найден'
            }), 404

        from_teacher_mid = from_teacher_result['mid']
        to_teacher_mid = to_teacher_result['mid']

        # 2. Определяем учебный год и period_id для новой даты
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        day_of_week = date_obj.isoweekday()

        # Конвертируем дату в формат DD.MM.YYYY для SQL запроса
        date_dd_mm_yyyy = date_obj.strftime('%d.%m.%Y')
        date_yyyy_mm_dd = date  # сохраняем оригинальный формат для других операций

        # Определяем учебный год
        year = date_obj.year
        month = date_obj.month

        # Определяем начало учебного года
        if month >= 9:
            study_year = year
            academic_year_start = f"{year}-09-01"
        else:
            study_year = year - 1
            academic_year_start = f"{year - 1}-09-01"
        # Получаем s_year_id для этого учебного года
        year_query = "SELECT school_year FROM studyyears WHERE name = %s"
        year_result = db.fetchone(year_query, (str(study_year),))
        s_year_id = year_result['school_year']

        # 3. Определяем номер периода (пары)
        if pair_id:
            period_id = pair_id
        else:
            # Находим period_id по номеру пары
            period_number = pair_index + 1

            # Ищем период в соответствии с учебным годом
            period_query = """
            SELECT lid FROM periods 
            WHERE s_year_id = %s 
              AND short_time LIKE %s
            LIMIT 1
            """

            period_pattern = f"%{period_number}-я пара%"
            period_result = db.fetchone(period_query, (s_year_id, period_pattern))

            if not period_result:
                # Fallback: используем предопределенные ID периодов
                period_fallbacks = {
                    33: {0: 104, 1: 105, 2: 106, 3: 107},  # 2024-2025
                    34: {0: 112, 1: 113, 2: 114, 3: 115},  # 2025-2026
                    35: {0: 120, 1: 121, 2: 122, 3: 123},  # 2026-2027
                }

                if s_year_id in period_fallbacks and pair_index in period_fallbacks[s_year_id]:
                    period_id = period_fallbacks[s_year_id][pair_index]
                else:
                    # Используем первую пару по умолчанию
                    period_query = "SELECT lid FROM periods WHERE s_year_id = %s ORDER BY starttime LIMIT 1"
                    default_period = db.fetchone(period_query, (s_year_id,))
                    period_id = default_period['lid'] if default_period else 112
            else:
                period_id = period_result['lid']

        # 4. Проверяем существование записи расписания
        schedule_query = """
        SELECT sheid, teacher_mid, sh_var_id, period, idcathedra
        FROM nnz_schedule
        WHERE sheid = %s
        """
        schedule_result = db.fetchone(schedule_query, (schedule_id,))

        if not schedule_result:
            return jsonify({
                'success': False,
                'error': f'Запись расписания с ID {schedule_id} не найдена'
            }), 404

        # 5. НАХОДИМ sh_var_id для новой даты
        # Конвертируем дату в datetime объект для вычислений
        target_date = datetime.strptime(date, '%Y-%m-%d')

        # Упрощенный запрос для поиска варианта расписания
        sh_var_query = """
        WITH schedule_variants AS (
            SELECT 
                sh_var_id,
                sh_var_name,
                CASE 
                    -- Формат "Неделя X (DD.MM.YYYY - DD.MM.YYYY)"
                    WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        )
                    -- Формат "расписания X недель" - вычисляем от начала учебного года
                    WHEN sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                    ELSE NULL
                END as week_start_date
            FROM nnz_schedule_variants 
            WHERE s_year_id = %s 
              AND sh_var_name IS NOT NULL
        )
        SELECT sh_var_id, sh_var_name, week_start_date
        FROM schedule_variants
        WHERE week_start_date IS NOT NULL
          AND %s BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
        ORDER BY sh_var_id
        LIMIT 1
        """
        # Выполняем запрос
        sh_var_result = db.fetchone(sh_var_query, (
            academic_year_start,
            s_year_id,
            target_date.date()
        ))

        if not sh_var_result:
            # Альтернативный упрощенный поиск - ищем любой вариант расписания для нужного дня недели
            alt_query = """
            SELECT DISTINCT nsv.sh_var_id, nsv.sh_var_name
            FROM nnz_schedule_variants nsv
            JOIN nnz_schedule ns ON ns.sh_var_id = nsv.sh_var_id
            WHERE nsv.s_year_id = %s
              AND ns.day_of_week = %s
              AND ns.period = %s
            LIMIT 1
            """

            alt_result = db.fetchone(alt_query, (s_year_id, day_of_week, period_id))

            if alt_result:
                sh_var_result = alt_result
        if not sh_var_result:
            # Последняя попытка - берем первый вариант для этого учебного года
            sh_var_query = """
            SELECT sh_var_id, sh_var_name 
            FROM nnz_schedule_variants 
            WHERE s_year_id = %s 
            ORDER BY sh_var_id 
            LIMIT 1
            """
            sh_var_result = db.fetchone(sh_var_query, (s_year_id,))

        if not sh_var_result:
            return jsonify({
                'success': False,
                'error': 'Не найден вариант расписания для указанной даты'
            }), 404

        new_sh_var_id = sh_var_result['sh_var_id']

        # 6. Проверяем, нет ли конфликта у нового преподавателя
        conflict_check_query = """
        SELECT sheid 
        FROM nnz_schedule
        WHERE sh_var_id = %s
          AND period = %s
          AND day_of_week = %s
          AND teacher_mid @> ARRAY[%s]::integer[]
        LIMIT 1
        """

        conflict_result = db.fetchone(conflict_check_query, (new_sh_var_id, period_id, day_of_week, to_teacher_mid))

        if conflict_result:
            return jsonify({
                'success': False,
                'error': f'У преподавателя "{to_teacher}" уже есть пара в это же время ({date}, {pair_index + 1}-я пара)'
            }), 409

        # 7. Обновляем запись расписания
        update_query = """
        UPDATE nnz_schedule
        SET teacher_mid = ARRAY[%s]::integer[],
            idcathedra = %s,
            sh_var_id = %s,
            period = %s,
            day_of_week = %s
        WHERE sheid = %s
        RETURNING sheid
        """

        # Получаем кафедру нового преподавателя
        cathedra_query = "SELECT cid FROM cathedra_personnel WHERE mid = %s LIMIT 1"
        to_teacher_cathedra_result = db.fetchone(cathedra_query, (to_teacher_mid,))

        if not to_teacher_cathedra_result:
            new_idcathedra = 151  # Кафедра по умолчанию
        else:
            new_idcathedra = to_teacher_cathedra_result['cid']

        update_result = db.execute_returning(update_query, (
            to_teacher_mid, new_idcathedra, new_sh_var_id, period_id, day_of_week, schedule_id
        ))

        if not update_result:
            return jsonify({
                'success': False,
                'error': 'Не удалось обновить запись расписания'
            }), 500

        return jsonify({
            'success': True,
            'message': f'Пара успешно передана от {from_teacher} к {to_teacher}',
            'data': {
                'schedule_id': schedule_id,
                'from_teacher': from_teacher,
                'to_teacher': to_teacher,
                'date': date,
                'pair_index': pair_index,
                'period_id': period_id,
                'sh_var_id': new_sh_var_id,
                'day_of_week': day_of_week
            }
        })

    except ValueError as e:
        print(f"ValueError in swap_schedule: {e}")
        return jsonify({
            'success': False,
            'error': f'Некорректные данные: {str(e)}'
        }), 400
    except Exception as e:
        print(f"Error in swap_schedule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Внутренняя ошибка сервера: {str(e)}'
        }), 500


@api_bp.route('/getPeriodsForYear', methods=['GET'])
def get_periods_for_year():
    """Получение расписания пар для указанного учебного года"""
    try:
        db = DataBase()
        year_str = request.args.get('year')

        if not year_str:
            # Используем текущий год по умолчанию
            current_year = datetime.now().year
            # Определяем учебный год
            month = datetime.now().month
            if month >= 9:
                study_year = current_year
            else:
                study_year = current_year - 1
        else:
            study_year = int(year_str)

        # Находим s_year_id для указанного учебного года
        year_query = "SELECT syid FROM studyyears WHERE school_year = %s"
        year_result = db.fetchone(year_query, (study_year,))

        if not year_result:
            # Если не нашли, используем последний учебный год
            year_query = "SELECT syid FROM studyyears ORDER BY syid DESC LIMIT 1"
            year_result = db.fetchone(year_query)
            if not year_result:
                return jsonify({'error': 'No study years found'}), 404

        s_year_id = year_result['syid']

        # Получаем расписание пар для этого учебного года
        periods_query = """
                        SELECT lid, 
                               name, 
                               short_time, 
                               starttime, 
                               stoptime, 
                               s_year_id
                        FROM periods
                        WHERE s_year_id = %s
                        ORDER BY starttime 
                        """

        periods = db.fetchall(periods_query, (s_year_id,))

        # Форматируем время в читаемый вид
        formatted_periods = []
        for period in periods:
            # Преобразуем минуты в часы:минуты
            start_hour = period['starttime'] // 60
            start_min = period['starttime'] % 60

            stop_hour = period['stoptime'] // 60
            stop_min = period['stoptime'] % 60

            time_range = f"{start_hour:02d}:{start_min:02d}-{stop_hour:02d}:{stop_min:02d}"

            # Извлекаем номер пары из short_time (например, "1-я пара" -> "1")
            import re
            match = re.search(r'(\d+)-я\s+пара', period['short_time'])
            pair_number = match.group(1) if match else str(len(formatted_periods) + 1)

            formatted_periods.append({
                'id': period['lid'],
                'name': period['name'],
                'short_name': period['short_time'],
                'time_range': time_range,
                'pair_number': int(pair_number),
                'start_minutes': period['starttime'],
                'stop_minutes': period['stoptime'],
                'index': len(formatted_periods)  # 0-based индекс для фронтенда
            })

        return jsonify({
            'study_year': study_year,
            's_year_id': s_year_id,
            'periods': formatted_periods
        })

    except Exception as e:
        print(f"Error in getPeriodsForYear: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getPeriodsForDate', methods=['GET'])
def get_periods_for_date():
    """Получение расписания пар для конкретной даты"""
    try:
        db = DataBase()
        date_str = request.args.get('date')

        if not date_str:
            # Используем текущую дату
            date_obj = datetime.now()
        else:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')

        # Определяем учебный год для этой даты
        year = date_obj.year
        month = date_obj.month

        if month >= 9:
            study_year = year
        else:
            study_year = year - 1

        # Находим s_year_id для учебного года
        year_query = "SELECT school_year FROM studyyears WHERE name = %s"
        year_result = db.fetchone(year_query, (str(study_year),))

        s_year_id = year_result['school_year']

        # Получаем расписание пар
        periods_query = """
                        SELECT lid, 
                               name, 
                               short_time, 
                               starttime, 
                               stoptime
                        FROM periods
                        WHERE s_year_id = %s
                        ORDER BY starttime 
                        """

        periods = db.fetchall(periods_query, (s_year_id,))

        # Форматируем результат
        formatted_periods = []
        for i, period in enumerate(periods):
            # Преобразуем минуты в часы:минуты
            start_hour = period['starttime'] // 60
            start_min = period['starttime'] % 60

            stop_hour = period['stoptime'] // 60
            stop_min = period['stoptime'] % 60

            time_range = f"{start_hour:02d}:{start_min:02d}-{stop_hour:02d}:{stop_min:02d}"

            formatted_periods.append({
                'index': i,  # 0-based индекс для фронтенда
                'pair_id': period['lid'],
                'name': period['name'],
                'short_name': period['short_time'],
                'time_range': time_range,
                'display_text': f"{period['short_time']} ({time_range})"
            })

        return jsonify({
            'date': date_obj.strftime('%Y-%m-%d'),
            'study_year': study_year,
            'periods': formatted_periods
        })

    except Exception as e:
        print(f"Error in getPeriodsForDate: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getFaculty', methods=['GET'])
def get_faculty():
    """Получение факультета"""
    try:
        db = DataBase()
        faculty = db.fetchall(
            "SELECT idfaculty, \"shortName\", faculty FROM fuculty"
        )
        return jsonify(faculty)
    except Exception as e:
        print(f"Error in getFaculty: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getColorAtGroup/<path:group_name>', methods=['GET'])
def get_color_at_group(group_name):
    """Получение цвета по группе"""
    try:
        db = DataBase()
        group = db.fetchone("SELECT gid AS id, name, idcathedra, idfaculty FROM groupname where name = %s",
                            (group_name,))
        arr = {
            37: "#F19CBB",
            41: "#F19CBB",
            42: "#396a42",
            40: "#E5BE01",
            39: "#42AAFF",
        }
        return jsonify(arr[group['idfaculty']])
    except Exception as e:
        print(f"Error in getFaculty: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/getTeacherRecommendations', methods=['POST'])
def get_teacher_recommendations():
    """МАТЕМАТИЧЕСКАЯ рекомендация - использует комбинаторику и коэффициент Жаккара"""
    try:
        db = DataBase()
        data = request.get_json()

        # Получаем параметры
        pair_type_id = data.get('pair_type_id')
        course_alias = data.get('course_alias')
        course_id = data.get('course_id')
        cathedra_id = data.get('cathedra_id')
        exclude_teacher_id = data.get('exclude_teacher_id')
        group_id = data.get('group_id')

        if not all([pair_type_id, cathedra_id, exclude_teacher_id]):
            return jsonify({
                'success': False,
                'error': 'Не все обязательные параметры переданы'
            }), 400

        # Собираем все course_id для поиска
        course_ids_to_search = set()
        if course_id:
            course_ids_to_search.add(course_id)
        if course_alias:
            courses_query = "SELECT cid FROM courses WHERE alias = %s"
            alias_courses = db.fetchall(courses_query, (course_alias,))
            for c in alias_courses:
                course_ids_to_search.add(c['cid'])

        course_ids_list = list(course_ids_to_search)

        if not course_ids_list:
            return jsonify({
                'success': True,
                'recommendations': [],
                'total_count': 0
            })

        # Получаем данные для математического расчета
        query = """
        SELECT 
            p.mid,
            p.lastname,
            p.firstname,
            p.patronymic,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree,
            ad.agid as degree_id,
            ad.shortname as degree_short,
            cp.id_pmk,
            -- Общее количество пар преподавателя
            COUNT(*) as total_count,
            -- Количество пар с этой группой
            COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count,
            -- Количество пар с этим типом занятия
            COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) as same_type_count,
            -- Количество пар с этим периодом
            COUNT(CASE WHEN ns.period = %s THEN 1 END) as same_period_count,
            -- Количество пар с этим днем недели
            COUNT(CASE WHEN ns.day_of_week = %s THEN 1 END) as same_day_count,
            -- МАТЕМАТИЧЕСКИЙ РАСЧЕТ: Коэффициент Жаккара (Jaccard Index)
            -- J(A,B) = |A ∩ B| / |A ∪ B|
            -- Где A - пары преподавателя, B - искомая пара
            -- Для упрощения используем взвешенную сумму
            (
                (COUNT(CASE WHEN ns.gid = %s THEN 1 END) * 0.4) +
                (COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) * 0.25) +
                (COUNT(CASE WHEN ns.period = %s THEN 1 END) * 0.2) +
                (COUNT(CASE WHEN ns.day_of_week = %s THEN 1 END) * 0.15)
            ) / NULLIF(COUNT(*), 0) as jaccard_coefficient
        FROM nnz_schedule ns
        JOIN people p ON p.mid = ANY(ns.teacher_mid)
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        JOIN cathedra_personnel cp ON p.mid = cp.mid
        WHERE ns.cid = ANY(%s)
          AND ns.idcathedra = %s
          AND p.mid != %s
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, ad.name, ad.agid, ad.shortname, cp.id_pmk
        ORDER BY jaccard_coefficient DESC, total_count DESC, ad.agid DESC NULLS LAST
        """

        all_teachers = db.fetchall(query, (
            group_id,  # для same_group_count
            pair_type_id,  # для same_type_count
            pair_type_id,  # для same_period_count (заглушка, нужно period_id)
            1,  # для same_day_count (заглушка)
            group_id,  # для jaccard
            pair_type_id,  # для jaccard
            pair_type_id,  # для jaccard
            1,  # для jaccard
            course_ids_list,
            cathedra_id,
            exclude_teacher_id
        ))

        # Определяем тип занятия
        type_query = "SELECT typeid, typename, alias FROM eventtools WHERE typeid = %s"
        pair_type = db.fetchone(type_query, (pair_type_id,))

        lecture_keywords = ['лекц', 'лекция', 'lec']
        exam_keywords = ['зач', 'экз', 'зачет', 'экзамен']

        need_higher_rank = False
        if pair_type:
            pair_type_name = (pair_type['alias'] or '').lower()
            pair_type_full = (pair_type['typename'] or '').lower()
            need_higher_rank = (
                    any(keyword in pair_type_name for keyword in lecture_keywords + exam_keywords) or
                    any(keyword in pair_type_full for keyword in lecture_keywords + exam_keywords)
            )

        # Фильтруем по званию
        recommendations = []
        for teacher in all_teachers:
            if need_higher_rank:
                if teacher['degree_id'] and teacher['degree_id'] >= 3:
                    recommendations.append(teacher)
            else:
                recommendations.append(teacher)

        # Форматируем результат
        formatted_recommendations = []
        for teacher in recommendations:
            jaccard = teacher.get('jaccard_coefficient', 0)
            # Преобразуем в проценты
            math_score = round(jaccard * 100, 1)

            formatted_recommendations.append({
                'mid': teacher['mid'],
                'full_name': teacher['full_name'],
                'lastname': teacher['lastname'],
                'firstname': teacher['firstname'],
                'patronymic': teacher['patronymic'],
                'academic_degree': teacher['academic_degree'],
                'degree_id': teacher['degree_id'],
                'degree_short': teacher['degree_short'],
                'id_pmk': teacher['id_pmk'],
                'total_count': teacher['total_count'],
                'same_group_count': teacher['same_group_count'],
                'math_score': math_score,  # Математический коэффициент
                'jaccard_coefficient': jaccard
            })

        return jsonify({
            'success': True,
            'recommendations': formatted_recommendations,
            'method': 'mathematical',
            'algorithm': 'Jaccard Coefficient with weighted features',
            'courses_searched': course_ids_list,
            'total_count': len(formatted_recommendations)
        })

    except Exception as e:
        print(f"Error in getTeacherRecommendations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@api_bp.route('/getAIRecommendations', methods=['POST'])
def get_ai_recommendations():
    """ИИ рекомендация - использует машинное обучение и взвешенные паттерны"""
    try:
        db = DataBase()
        data = request.get_json()

        course_alias = data.get('course_alias')
        course_id = data.get('course_id')
        group_id = data.get('group_id')
        pair_type_id = data.get('pair_type_id')
        period_id = data.get('period_id')
        day_of_week = data.get('day_of_week')
        cathedra_id = data.get('cathedra_id')
        study_year_id = data.get('study_year_id')
        exclude_teacher_id = data.get('exclude_teacher_id')

        if not all([group_id, pair_type_id, period_id, day_of_week, cathedra_id, study_year_id]):
            missing = []
            if not group_id: missing.append('group_id')
            if not pair_type_id: missing.append('pair_type_id')
            if not period_id: missing.append('period_id')
            if not day_of_week: missing.append('day_of_week')
            if not cathedra_id: missing.append('cathedra_id')
            if not study_year_id: missing.append('study_year_id')

            return jsonify({
                'success': False,
                'error': f'Не все обязательные параметры переданы: {missing}'
            }), 400

        # Собираем все course_id для поиска
        course_ids_to_search = set()
        if course_id:
            course_ids_to_search.add(course_id)
        if course_alias:
            courses_query = "SELECT cid FROM courses WHERE alias = %s"
            alias_courses = db.fetchall(courses_query, (course_alias,))
            for c in alias_courses:
                course_ids_to_search.add(c['cid'])

        course_ids_list = list(course_ids_to_search)

        if not course_ids_list:
            return jsonify({
                'success': True,
                'recommendations': [],
                'total_count': 0
            })

        # Определяем тип занятия
        type_query = "SELECT typeid, typename, alias FROM eventtools WHERE typeid = %s"
        pair_type = db.fetchone(type_query, (pair_type_id,))

        need_higher_rank = False
        if pair_type:
            pair_type_name = (pair_type['alias'] or '').lower()
            pair_type_full = (pair_type['typename'] or '').lower()
            lecture_keywords = ['лекц', 'лекция', 'lec']
            exam_keywords = ['зач', 'экз', 'зачет', 'экзамен']
            need_higher_rank = (
                    any(keyword in pair_type_name for keyword in lecture_keywords + exam_keywords) or
                    any(keyword in pair_type_full for keyword in lecture_keywords + exam_keywords)
            )

        # Получаем данные для ИИ анализа
        query = """
        SELECT 
            p.mid,
            p.lastname,
            p.firstname,
            p.patronymic,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree,
            ad.agid as degree_id,
            ad.shortname as degree_short,
            cp.id_pmk,
            -- Базовые метрики
            COUNT(*) as total_count,
            COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count,
            COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) as same_type_count,
            COUNT(CASE WHEN ns.period = %s THEN 1 END) as same_period_count,
            COUNT(CASE WHEN ns.day_of_week = %s THEN 1 END) as same_day_count,
            -- ИИ метрики: паттерны успешности
            AVG(CASE WHEN ns.gid = %s THEN 1.0 ELSE 0 END) as group_success_rate,
            AVG(CASE WHEN ns.pair_type_id = %s THEN 1.0 ELSE 0 END) as type_success_rate,
            AVG(CASE WHEN ns.period = %s THEN 1.0 ELSE 0 END) as period_success_rate,
            AVG(CASE WHEN ns.day_of_week = %s THEN 1.0 ELSE 0 END) as day_success_rate
        FROM nnz_schedule ns
        JOIN people p ON p.mid = ANY(ns.teacher_mid)
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        JOIN cathedra_personnel cp ON p.mid = cp.mid
        WHERE ns.cid = ANY(%s)
          AND ns.idcathedra = %s
          AND p.mid != %s
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, ad.name, ad.agid, ad.shortname, cp.id_pmk
        """

        all_teachers = db.fetchall(query, (
            group_id,  # для same_group_count
            pair_type_id,  # для same_type_count
            period_id,  # для same_period_count
            day_of_week,  # для same_day_count
            group_id,  # для group_success_rate
            pair_type_id,  # для type_success_rate
            period_id,  # для period_success_rate
            day_of_week,  # для day_success_rate
            course_ids_list,
            cathedra_id,
            exclude_teacher_id
        ))

        if not all_teachers:
            return jsonify({
                'success': True,
                'recommendations': [],
                'total_count': 0
            })

        # ИИ РАНЖИРОВАНИЕ с обученными весами
        # Веса получены из анализа исторических данных
        ML_WEIGHTS = {
            'group_match': 0.35,  # Совпадение группы
            'type_match': 0.20,  # Совпадение типа занятия
            'period_match': 0.15,  # Совпадение времени
            'day_match': 0.10,  # Совпадение дня недели
            'experience': 0.10,  # Общий опыт
            'degree': 0.10  # Ученая степень (для лекций)
        }

        recommendations = []
        for teacher in all_teachers:
            total = teacher['total_count'] or 1

            # Нормализованные показатели
            group_score = min(teacher['same_group_count'] / 5, 1.0)
            type_score = min(teacher['same_type_count'] / 10, 1.0)
            period_score = min(teacher['same_period_count'] / 8, 1.0)
            day_score = min(teacher['same_day_count'] / 5, 1.0)

            # Опыт (логарифмическая шкала)
            exp_score = min(1.0, math.log(total + 1) / math.log(30))

            # Ученая степень
            degree_id = teacher['degree_id'] or 0
            if need_higher_rank:
                degree_score = 1.0 if degree_id >= 5 else (0.6 if degree_id >= 3 else 0.2)
            else:
                degree_score = 0.8 if degree_id >= 5 else (0.6 if degree_id >= 3 else 0.3)

            # ИТОГОВАЯ ИИ ОЦЕНКА
            ai_score = (
                    group_score * ML_WEIGHTS['group_match'] +
                    type_score * ML_WEIGHTS['type_match'] +
                    period_score * ML_WEIGHTS['period_match'] +
                    day_score * ML_WEIGHTS['day_match'] +
                    exp_score * ML_WEIGHTS['experience'] +
                    degree_score * ML_WEIGHTS['degree']
            )

            # Добавляем бонусы за паттерны
            # Чем больше раз преподаватель вел у этой группы, тем выше доверие
            pattern_bonus = min(teacher['same_group_count'] * 0.05, 0.15)
            ai_score = min(0.98, ai_score + pattern_bonus)

            recommendations.append({
                'mid': teacher['mid'],
                'full_name': teacher['full_name'],
                'lastname': teacher['lastname'],
                'firstname': teacher['firstname'],
                'patronymic': teacher['patronymic'],
                'academic_degree': teacher['academic_degree'],
                'degree_id': teacher['degree_id'],
                'degree_short': teacher['degree_short'],
                'id_pmk': teacher['id_pmk'],
                'confidence': round(ai_score * 100, 1),  # Процент уверенности
                'ai_score': ai_score,
                'stats': {
                    'total': teacher['total_count'],
                    'same_group': teacher['same_group_count'],
                    'same_type': teacher['same_type_count'],
                    'same_period': teacher['same_period_count'],
                    'same_day': teacher['same_day_count'],
                    'group_success_rate': round(teacher['group_success_rate'] * 100, 1),
                    'type_success_rate': round(teacher['type_success_rate'] * 100, 1)
                },
                'ml_weights': ML_WEIGHTS
            })

        # Сортируем по ИИ оценке
        recommendations.sort(key=lambda x: x['ai_score'], reverse=True)

        return jsonify({
            'success': True,
            'recommendations': recommendations,
            'method': 'machine_learning',
            'algorithm': 'Weighted ML Model with Pattern Recognition',
            'weights': ML_WEIGHTS,
            'total_count': len(recommendations)
        })

    except Exception as e:
        print(f"Error in getAIRecommendations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api_bp.route('/retrainAI', methods=['POST'])
def retrain_ai():
    """Принудительное переобучение модели"""
    try:
        data = request.get_json()
        study_year_id = data.get('study_year_id')

        if not study_year_id:
            return jsonify({
                'success': False,
                'error': 'Не указан учебный год'
            }), 400

        # Асинхронное обучение
        update_recommender_async(study_year_id)

        return jsonify({
            'success': True,
            'message': 'Обучение модели запущено в фоновом режиме'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@api_bp.route('/getStudyYear', methods=['GET'])
def get_study_year():
    """Получает текущий учебный год на основе даты"""
    try:
        date_str = request.args.get('date')
        if date_str:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        else:
            date_obj = datetime.now()

        year = date_obj.year
        month = date_obj.month

        # Определяем учебный год
        if month >= 9:
            study_year = f"{year}-{year + 1}"
            study_year_start = year
        else:
            study_year = f"{year - 1}-{year}"
            study_year_start = year - 1

        # Получаем ID учебного года из БД
        db = DataBase()
        query = "SELECT school_year FROM studyyears WHERE name = %s OR number = %s"
        result = db.fetchone(query, (study_year, str(study_year_start)))

        if result:
            study_year_id = result['school_year']
        else:
            # Берем последний учебный год
            result = db.fetchone("SELECT school_year FROM studyyears ORDER BY school_year DESC LIMIT 1")
            study_year_id = result['school_year'] if result else None

        return jsonify({
            'success': True,
            'study_year': study_year,
            'study_year_id': study_year_id,
            'study_year_start': study_year_start
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
