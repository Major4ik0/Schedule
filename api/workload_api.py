# -*- coding: utf-8 -*-
import io
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask import send_file

from .schedule_utils import DataBase

# Добавим в начало файла
try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False
    print("Warning: openpyxl not installed. Excel export will not work.")

# Создаем blueprint для API нагрузки
workload_bp = Blueprint('workload', __name__, url_prefix='/api/workload')


@workload_bp.route('/getTeachers', methods=['GET'])
def get_teachers():
    """Получение списка всех преподавателей с дополнительной информацией"""
    try:
        db = DataBase()

        query = """
        SELECT DISTINCT
            p.mid as teacher_id,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            cp.cid as cathedra_id,
            c.cathedra as cathedra_name,
            c.shortname as cathedra_short,
            cp.id_pmk as pmk_id,
            pm.name_pmk as pmk_name,
            cp.positionid as position_id,
            ad.name as academic_degree
        FROM people AS p
        LEFT JOIN cathedra_personnel AS cp ON p.mid = cp.mid
        LEFT JOIN cathedras AS c ON cp.cid = c.idcathedra
        LEFT JOIN pmk AS pm ON cp.id_pmk = pm.id_pmk
        LEFT JOIN academicdegree AS ad ON p.degree = ad.agid
        WHERE cp.id_pmk IN (1, 2) OR cp.id_pmk IS NULL
        ORDER BY full_name
        """

        teachers = db.fetchall(query)

        # Форматируем для фронтенда
        formatted_teachers = []
        for teacher in teachers:
            formatted_teachers.append({
                'id': teacher['teacher_id'],
                'name': teacher['full_name'],
                'cathedra': {
                    'id': teacher['cathedra_id'],
                    'name': teacher['cathedra_name'],
                    'short': teacher['cathedra_short']
                } if teacher['cathedra_id'] else None,
                'pmk': {
                    'id': teacher['pmk_id'],
                    'name': teacher['pmk_name']
                } if teacher['pmk_id'] else None,
                'academic_degree': teacher['academic_degree'],
                'position_id': teacher['position_id']
            })

        return jsonify(formatted_teachers)

    except Exception as e:
        print(f"Error in getTeachers (workload): {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getFaculties', methods=['GET'])
def get_faculties():
    """Получение списка всех факультетов"""
    try:
        db = DataBase()

        query = """
        SELECT 
            idfaculty as id,
            faculty as name,
            "shortName" as short_name
        FROM fuculty
        """

        faculties = db.fetchall(query)
        return jsonify(faculties)

    except Exception as e:
        print(f"Error in getFaculties: {e}")
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getWorkload', methods=['POST'])
def get_workload():
    """Получение нагрузки преподавателей по фильтрам"""
    try:
        db = DataBase()
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        # Извлекаем параметры фильтрации
        teacher_ids = data.get('teachers', [])  # массив ID преподавателей
        period_type = data.get('period', 'month')  # month, quarter, semester, year, custom
        faculty_id = data.get('faculty', 'all')  # ID факультета или 'all'
        lesson_types = data.get('types', ['Л', 'ПЗ', 'ЛР', 'Э', 'С'])  # Используем алиасы из базы
        date_from = data.get('dateFrom')
        date_to = data.get('dateTo')

        # Определяем даты периода
        today = datetime.now()

        if period_type == 'month':
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')
        elif period_type == 'quarter':
            current_quarter = (today.month - 1) // 3 + 1
            quarter_start_month = (current_quarter - 1) * 3 + 1
            first_day = today.replace(month=quarter_start_month, day=1)
            last_day = (first_day + timedelta(days=93)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')
        elif period_type == 'semester':
            # Определяем семестр (сентябрь-январь или февраль-июнь)
            if today.month in [9, 10, 11, 12, 1]:
                # Первый семестр
                if today.month >= 9:
                    year = today.year
                else:
                    year = today.year - 1
                date_from = f"{year}-09-01"
                date_to = f"{year + 1}-01-31"
            else:
                # Второй семестр
                year = today.year
                date_from = f"{year}-02-01"
                date_to = f"{year}-06-30"
        elif period_type == 'year':
            # Учебный год (сентябрь-июнь)
            if today.month >= 9:
                year = today.year
            else:
                year = today.year - 1
            date_from = f"{year}-09-01"
            date_to = f"{year + 1}-06-30"
        elif period_type == 'custom' and date_from and date_to:
            # Используем пользовательские даты
            pass
        else:
            # По умолчанию - текущий месяц
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')

        # Собираем параметры запроса
        params = []

        # Определяем начало учебного года для вычисления дат
        year_from = datetime.strptime(date_from, '%Y-%m-%d').year
        month_from = datetime.strptime(date_from, '%Y-%m-%d').month

        if month_from >= 9:
            academic_year_start = f"{year_from}-09-01"
        else:
            academic_year_start = f"{year_from - 1}-09-01"

        # Базовый запрос для получения нагрузки
        workload_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.cid,
                ns.gid,
                ns.teacher_mid,
                ns.period,
                ns.day_of_week,
                ns.pair_type_id,
                ns.idcathedra,
                nsv.sh_var_name,
                nsv.s_year_id,
                -- Вычисляем дату занятия
                CASE 
                    -- Формат "Неделя X (DD.MM.YYYY - DD.MM.YYYY)"
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    -- Формат "расписания X недель" - вычисляем от начала учебного года
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    -- Для прочих случаев используем статическую дату (для тестирования)
                    ELSE DATE %s + (ns.day_of_week - 1) * INTERVAL '1 day'
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid IS NOT NULL
            AND array_length(ns.teacher_mid, 1) > 0
        ),
        filtered_schedule AS (
            SELECT *
            FROM schedule_data
            WHERE event_date BETWEEN %s AND %s
        )
        SELECT 
            p.mid as teacher_id,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS teacher_name,
            c.cathedra as cathedra_name,
            c.shortname as cathedra_short,
            f.faculty as faculty_name,
            -- Статистика по типам занятий (все типы из таблицы eventtools)
            COUNT(CASE WHEN et.alias = 'Л' THEN 1 END) as lecture_count,
            COUNT(CASE WHEN et.alias = 'ПЗ' THEN 1 END) as practice_count,
            COUNT(CASE WHEN et.alias = 'С' THEN 1 END) as seminar_count,
            COUNT(CASE WHEN et.alias = 'ЛР' THEN 1 END) as lab_count,
            COUNT(CASE WHEN et.alias = 'Э' THEN 1 END) as exam_count,
            COUNT(CASE WHEN et.alias = 'КР' THEN 1 END) as control_count,
            COUNT(CASE WHEN et.alias = 'З' THEN 1 END) as test_count,
            COUNT(CASE WHEN et.alias = 'ГУ' THEN 1 END) as group_ex_count,
            COUNT(CASE WHEN et.alias = 'КуР' THEN 1 END) as course_work_count,
            COUNT(CASE WHEN et.alias = 'ЭПр' THEN 1 END) as practicum_count,
            COUNT(CASE WHEN et.alias = 'ГЗ' THEN 1 END) as group_lesson_count,
            COUNT(CASE WHEN et.alias = 'ЗЧ' THEN 1 END) as pass_no_grade_count,
            -- Общее количество занятий (только выбранных типов)
            COUNT(CASE WHEN et.alias = ANY(%s) THEN 1 END) as total_lessons,
            -- Расчет часов (предполагаем 2 часа на занятие)
            COUNT(CASE WHEN et.alias = ANY(%s) THEN 1 END) * 2 as total_hours
        FROM filtered_schedule fs
        JOIN people p ON p.mid = ANY(fs.teacher_mid)
        LEFT JOIN cathedras c ON fs.idcathedra = c.idcathedra
        JOIN courses cr ON fs.cid = cr.cid
        JOIN eventtools et ON fs.pair_type_id = et.typeid
        LEFT JOIN groupname gn ON fs.gid = gn.gid
        LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
        WHERE 1=1
        """

        # Параметры для вычисления дат
        params.append(academic_year_start)
        params.append(academic_year_start)  # для статических случаев
        params.append(date_from)
        params.append(date_to)

        # Параметры для фильтрации по типам
        params.append(lesson_types)  # для подсчета total_lessons
        params.append(lesson_types)  # для подсчета total_hours

        # Фильтрация по преподавателям
        if teacher_ids:
            teacher_ids_int = list(map(int, teacher_ids))
            teacher_placeholders = ','.join(['%s'] * len(teacher_ids_int))
            workload_query += f" AND p.mid IN ({teacher_placeholders})"
            params.extend(teacher_ids_int)

        # Фильтрация по факультету
        if faculty_id != 'all':
            workload_query += " AND f.idfaculty = %s"
            params.append(int(faculty_id))

        # Фильтрация по типам занятий (только те, которые выбраны)
        if lesson_types:
            type_placeholders = ','.join(['%s'] * len(lesson_types))
            workload_query += f" AND et.alias IN ({type_placeholders})"
            params.extend(lesson_types)

        # Группировка
        workload_query += """
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
                 c.cathedra, c.shortname, f.faculty
        ORDER BY teacher_name
        """

        # Выполняем запрос
        workload_data = db.fetchall(workload_query, tuple(params))

        # Получаем статистику по норме часов
        norm_hours = 150  # Базовая норма часов в месяц

        # Форматируем результат
        formatted_data = []
        for row in workload_data:
            # Рассчитываем часы по каждому типу
            lecture_hours = row['lecture_count'] * 2
            practice_hours = row['practice_count'] * 2
            seminar_hours = row['seminar_count'] * 2
            lab_hours = row['lab_count'] * 2
            exam_hours = row['exam_count'] * 2
            control_hours = row['control_count'] * 2
            test_hours = row['test_count'] * 2
            group_ex_hours = row['group_ex_count'] * 2
            course_work_hours = row['course_work_count'] * 2
            practicum_hours = row['practicum_count'] * 2
            group_lesson_hours = row['group_lesson_count'] * 2
            pass_no_grade_hours = row['pass_no_grade_count'] * 2

            total_hours = row['total_hours']
            total_lessons = row['total_lessons']

            # Проверяем расчет
            calculated_hours = (lecture_hours + practice_hours + seminar_hours + lab_hours +
                                exam_hours + control_hours + test_hours + group_ex_hours +
                                course_work_hours + practicum_hours + group_lesson_hours +
                                pass_no_grade_hours)

            # Используем максимальное значение
            if calculated_hours > total_hours:
                total_hours = calculated_hours
                total_lessons = calculated_hours // 2

            percentage = min(round((total_hours / norm_hours) * 100), 100) if norm_hours > 0 else 0

            formatted_data.append({
                'teacher_id': row['teacher_id'],
                'teacher_name': row['teacher_name'],
                'faculty': row['faculty_name'],
                'cathedra': row['cathedra_name'],
                'cathedra_short': row['cathedra_short'],
                'lectures': lecture_hours,
                'practice': practice_hours,
                'seminars': seminar_hours,
                'labs': lab_hours,
                'exams': exam_hours,
                'controls': control_hours,
                'tests': test_hours,
                'group_exercises': group_ex_hours,
                'course_works': course_work_hours,
                'practicums': practicum_hours,
                'group_lessons': group_lesson_hours,
                'pass_no_grades': pass_no_grade_hours,
                'total_hours': total_hours,
                'total_lessons': total_lessons,
                'norm_hours': norm_hours,
                'percentage': percentage,
                'position': None  # Можно добавить при необходимости
            })

        # Вычисляем общую статистику
        total_hours_all = sum(item['total_hours'] for item in formatted_data)
        total_lessons_all = sum(item['total_lessons'] for item in formatted_data)
        teacher_count = len(formatted_data)
        average_hours = round(total_hours_all / teacher_count, 1) if teacher_count > 0 else 0

        stats = {
            'totalHours': total_hours_all,
            'teacherCount': teacher_count,
            'totalLessons': total_lessons_all,
            'averageHours': average_hours
        }

        return jsonify({
            'workload': formatted_data,
            'stats': stats,
            'period': {
                'from': date_from,
                'to': date_to,
                'type': period_type
            }
        })

    except Exception as e:
        print(f"!!! Ошибка в getWorkload: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc(),
            'workload': [],
            'stats': {
                'totalHours': 0,
                'teacherCount': 0,
                'totalLessons': 0,
                'averageHours': 0
            }
        }), 500


@workload_bp.route('/<int:teacher_id>/details', methods=['GET'])
def get_teacher_details(teacher_id):
    """Получение детальной нагрузки конкретного преподавателя"""
    try:
        db = DataBase()

        # Получаем информацию о преподавателе
        teacher_query = """
        SELECT 
            p.mid,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree,
            c.cathedra as cathedra_name,
            c.shortname as cathedra_short,
            cp.positionid as position_id,
            pm.name_pmk as pmk_name
        FROM people p
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        LEFT JOIN cathedra_personnel cp ON p.mid = cp.mid
        LEFT JOIN cathedras c ON cp.cid = c.idcathedra
        LEFT JOIN pmk pm ON cp.id_pmk = pm.id_pmk
        WHERE p.mid = %s
        LIMIT 1
        """

        teacher_info = db.fetchone(teacher_query, (teacher_id,))

        if not teacher_info:
            return jsonify({'error': 'Преподаватель не найден'}), 404

        # Получаем занятия преподавателя за последний месяц
        month_ago = datetime.now() - timedelta(days=30)
        date_from = month_ago.strftime('%Y-%m-%d')
        date_to = datetime.now().strftime('%Y-%m-%d')

        # Определяем начало учебного года для вычисления дат
        year_from = datetime.strptime(date_from, '%Y-%m-%d').year
        month_from = datetime.strptime(date_from, '%Y-%m-%d').month

        if month_from >= 9:
            academic_year_start = f"{year_from}-09-01"
        else:
            academic_year_start = f"{year_from - 1}-09-01"

        lessons_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.cid,
                ns.gid,
                ns.period,
                ns.day_of_week,
                ns.pair_type_id,
                nsv.sh_var_name,
                -- Вычисляем дату занятия
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE DATE %s + (ns.day_of_week - 1) * INTERVAL '1 day'
                END as event_date,
                per.name as period_name,
                per.short_time as period_short,
                per.starttime,
                per.stoptime,
                cr.alias as course_name,
                cr.title as course_full_name,
                et.alias as event_type,
                et.typename as event_type_full,
                gn.name as group_name,
                r.short_name as room_name,
                r.name as room_full_name,
                f.faculty as faculty_name
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            JOIN periods per ON ns.period = per.lid
            JOIN courses cr ON ns.cid = cr.cid
            JOIN eventtools et ON ns.pair_type_id = et.typeid
            JOIN groupname gn ON ns.gid = gn.gid
            LEFT JOIN rooms r ON r.rid = ANY(ns.rid)
            LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
            WHERE ns.teacher_mid @> ARRAY[%s]::integer[]
        )
        SELECT *
        FROM schedule_data
        WHERE event_date BETWEEN %s AND %s
        ORDER BY event_date, starttime
        """

        lessons = db.fetchall(lessons_query, (academic_year_start, academic_year_start, teacher_id, date_from, date_to))

        # Форматируем занятия
        formatted_lessons = []
        for lesson in lessons:
            # Преобразуем время
            start_hour = lesson['starttime'] // 60
            start_min = lesson['starttime'] % 60
            stop_hour = lesson['stoptime'] // 60
            stop_min = lesson['stoptime'] % 60

            time_range = f"{start_hour:02d}:{start_min:02d}-{stop_hour:02d}:{stop_min:02d}"

            formatted_lessons.append({
                'date': lesson['event_date'].strftime('%d.%m.%Y') if lesson['event_date'] else 'Нет даты',
                'subject': lesson['course_name'] or lesson['course_full_name'],
                'type': lesson['event_type'] or lesson['event_type_full'],
                'group': lesson['group_name'],
                'hours': 2,  # Предполагаем 2 часа на занятие
                'room': lesson['room_name'] or lesson['room_full_name'],
                'time_range': time_range,
                'period': lesson['period_name'],
                'faculty': lesson['faculty_name']
            })

        # Группируем данные по неделям для графика
        weekly_data = {}
        for lesson in lessons:
            if lesson['event_date']:
                week_num = lesson['event_date'].isocalendar()[1]
                if week_num not in weekly_data:
                    weekly_data[week_num] = 0
                weekly_data[week_num] += 2  # 2 часа на занятие

        # Сортируем недели
        sorted_weeks = sorted(weekly_data.keys())

        weekly_chart_data = {
            'labels': [f'Неделя {week}' for week in sorted_weeks],
            'data': [weekly_data[week] for week in sorted_weeks]
        }

        # Вычисляем статистику
        total_lessons = len(lessons)
        total_hours = total_lessons * 2

        # Находим пиковую и минимальную неделю
        if weekly_data:
            peak_week = max(weekly_data.values())
            min_week = min(weekly_data.values())
            avg_weekly = round(sum(weekly_data.values()) / len(weekly_data), 1)
        else:
            peak_week = 0
            min_week = 0
            avg_weekly = 0

        # Вычисляем процент загрузки (предполагаем норму 40 часов в месяц)
        norm_monthly = 40
        percentage = round((total_hours / norm_monthly) * 100, 1) if norm_monthly > 0 else 0

        stats = {
            'monthLessons': total_lessons,
            'monthHours': total_hours,
            'avgWorkload': f'{percentage}%',
            'avgWeekly': f'{avg_weekly} ч',
            'peakWeek': f'{peak_week} ч',
            'minWeek': f'{min_week} ч'
        }

        return jsonify({
            'teacher_info': {
                'id': teacher_info['mid'],
                'name': teacher_info['full_name'],
                'academic_degree': teacher_info['academic_degree'],
                'cathedra': teacher_info['cathedra_name'],
                'cathedra_short': teacher_info['cathedra_short'],
                'pmk': teacher_info['pmk_name'],
                'position_id': teacher_info['position_id']
            },
            'lessons': formatted_lessons,
            'weeklyData': weekly_chart_data,
            'stats': stats
        })

    except Exception as e:
        print(f"Error in get_teacher_details: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/export', methods=['POST'])
def export_workload():
    """Экспорт данных о нагрузке"""
    try:
        # Получаем те же данные, что и в getWorkload
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        # Используем ту же логику, что и в getWorkload
        # Здесь можно реализовать экспорт в Excel, PDF и т.д.
        # Для простоты вернем JSON с данными для экспорта

        # В реальной реализации здесь будет генерация Excel файла
        # используя библиотеку openpyxl или pandas

        return jsonify({
            'success': True,
            'message': 'Экспорт будет реализован в следующей версии',
            'data': data  # Возвращаем полученные данные для отладки
        })

    except Exception as e:
        print(f"Error in export_workload: {e}")
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/<int:teacher_id>/export', methods=['GET'])
def export_teacher_report(teacher_id):
    """Экспорт отчета по конкретному преподавателю"""
    try:
        # Получаем данные преподавателя
        # В реальной реализации здесь будет генерация PDF отчета

        return jsonify({
            'success': True,
            'message': 'Экспорт отчета преподавателя будет реализован в следующей версии',
            'teacher_id': teacher_id
        })

    except Exception as e:
        print(f"Error in export_teacher_report: {e}")
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getCathedras', methods=['GET'])
def get_cathedras():
    """Получение списка всех кафедр"""
    try:
        db = DataBase()

        query = """
        SELECT 
            c.idcathedra as id,
            c.cathedra as name,
            c.shortname as short_name,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic as chief_name
        FROM cathedras c
        LEFT JOIN people p ON c.chief = p.mid
        ORDER BY c.cathedra
        """

        cathedras = db.fetchall(query)
        return jsonify(cathedras)

    except Exception as e:
        print(f"Error in getCathedras: {e}")
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getStats', methods=['GET'])
def get_overall_stats():
    """Получение общей статистики по нагрузке"""
    try:
        db = DataBase()

        # Текущий месяц
        today = datetime.now()
        first_day = today.replace(day=1)
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        date_from = first_day.strftime('%Y-%m-%d')
        date_to = last_day.strftime('%Y-%m-%d')

        # Определяем начало учебного года
        year_from = datetime.strptime(date_from, '%Y-%m-%d').year
        month_from = datetime.strptime(date_from, '%Y-%m-%d').month

        if month_from >= 9:
            academic_year_start = f"{year_from}-09-01"
        else:
            academic_year_start = f"{year_from - 1}-09-01"

        # Запрос для общей статистики
        stats_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.teacher_mid,
                nsv.sh_var_name,
                -- Вычисляем дату занятия
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE NULL
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid IS NOT NULL
            AND ns.teacher_mid != '{}'
        ),
        filtered_schedule AS (
            SELECT 
                sheid,
                UNNEST(teacher_mid) as teacher_id
            FROM schedule_data
            WHERE event_date BETWEEN %s AND %s
        )
        SELECT 
            COUNT(DISTINCT teacher_id) as active_teachers,
            COUNT(*) as total_lessons,
            COUNT(*) * 2 as total_hours
        FROM filtered_schedule
        """

        stats = db.fetchone(stats_query, (academic_year_start, date_from, date_to))

        if not stats:
            stats = {
                'active_teachers': 0,
                'total_lessons': 0,
                'total_hours': 0
            }

        # Получаем количество всех преподавателей
        teachers_query = """
        SELECT COUNT(DISTINCT mid) as total_teachers
        FROM cathedra_personnel
        WHERE id_pmk IN (1, 2)
        """

        teachers_count = db.fetchone(teachers_query)

        # Вычисляем среднюю нагрузку
        avg_hours = round(stats['total_hours'] / stats['active_teachers'], 1) if stats['active_teachers'] > 0 else 0

        return jsonify({
            'totalTeachers': teachers_count['total_teachers'] if teachers_count else 0,
            'activeTeachers': stats['active_teachers'],
            'totalLessons': stats['total_lessons'],
            'totalHours': stats['total_hours'],
            'averageHours': avg_hours,
            'period': {
                'from': date_from,
                'to': date_to,
                'name': f"{today.strftime('%B %Y')}"
            }
        })

    except Exception as e:
        print(f"Error in getStats: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getDistribution', methods=['GET'])
def get_distribution():
    """Получение распределения нагрузки по факультетам/кафедрам"""
    try:
        db = DataBase()

        # Текущий месяц
        today = datetime.now()
        first_day = today.replace(day=1)
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        date_from = first_day.strftime('%Y-%m-%d')
        date_to = last_day.strftime('%Y-%m-%d')

        # Определяем начало учебного года
        year_from = datetime.strptime(date_from, '%Y-%m-%d').year
        month_from = datetime.strptime(date_from, '%Y-%m-%d').month

        if month_from >= 9:
            academic_year_start = f"{year_from}-09-01"
        else:
            academic_year_start = f"{year_from - 1}-09-01"

        # Распределение по факультетам
        faculty_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.gid,
                nsv.sh_var_name,
                -- Вычисляем дату занятия
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE NULL
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid IS NOT NULL
        ),
        filtered_schedule AS (
            SELECT gid
            FROM schedule_data
            WHERE event_date BETWEEN %s AND %s
        )
        SELECT 
            f.faculty as faculty_name,
            COUNT(*) as lesson_count,
            COUNT(*) * 2 as hour_count
        FROM filtered_schedule fs
        JOIN groupname gn ON fs.gid = gn.gid
        JOIN fuculty f ON gn.idfaculty = f.idfaculty
        GROUP BY f.faculty
        ORDER BY hour_count DESC
        """

        faculty_distribution = db.fetchall(faculty_query, (academic_year_start, date_from, date_to))

        # Распределение по типам занятий
        type_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.pair_type_id,
                nsv.sh_var_name,
                -- Вычисляем дату занятия
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE NULL
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid IS NOT NULL
        ),
        filtered_schedule AS (
            SELECT pair_type_id
            FROM schedule_data
            WHERE event_date BETWEEN %s AND %s
        )
        SELECT 
            et.alias as lesson_type,
            COUNT(*) as lesson_count,
            COUNT(*) * 2 as hour_count
        FROM filtered_schedule fs
        JOIN eventtools et ON fs.pair_type_id = et.typeid
        GROUP BY et.alias
        ORDER BY hour_count DESC
        """

        type_distribution = db.fetchall(type_query, (academic_year_start, date_from, date_to))

        return jsonify({
            'facultyDistribution': faculty_distribution,
            'typeDistribution': type_distribution,
            'period': {
                'from': date_from,
                'to': date_to
            }
        })

    except Exception as e:
        print(f"Error in getDistribution: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/exportExcel', methods=['POST'])
def export_excel():
    """Экспорт данных о нагрузке в Excel"""
    try:
        if not HAS_OPENPYXL:
            return jsonify({'error': 'openpyxl library not installed'}), 500

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        # Используем ту же логику, что и в getWorkload
        teacher_ids = data.get('teachers', [])
        period_type = data.get('period', 'month')
        faculty_id = data.get('faculty', 'all')
        lesson_types = data.get('types', ['Л', 'ПЗ', 'ЛР', 'Э', 'С'])
        date_from = data.get('dateFrom')
        date_to = data.get('dateTo')

        # Определяем даты периода (аналогично getWorkload)
        today = datetime.now()

        if period_type == 'month':
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')
        elif period_type == 'quarter':
            current_quarter = (today.month - 1) // 3 + 1
            quarter_start_month = (current_quarter - 1) * 3 + 1
            first_day = today.replace(month=quarter_start_month, day=1)
            last_day = (first_day + timedelta(days=93)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')
        elif period_type == 'semester':
            if today.month in [9, 10, 11, 12, 1]:
                if today.month >= 9:
                    year = today.year
                else:
                    year = today.year - 1
                date_from = f"{year}-09-01"
                date_to = f"{year + 1}-01-31"
            else:
                year = today.year
                date_from = f"{year}-02-01"
                date_to = f"{year}-06-30"
        elif period_type == 'year':
            if today.month >= 9:
                year = today.year
            else:
                year = today.year - 1
            date_from = f"{year}-09-01"
            date_to = f"{year + 1}-06-30"
        elif period_type == 'custom' and date_from and date_to:
            pass
        else:
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')

        # Получаем данные (можно использовать тот же запрос, что и в getWorkload)
        db = DataBase()

        # Определяем начало учебного года
        year_from = datetime.strptime(date_from, '%Y-%m-%d').year
        month_from = datetime.strptime(date_from, '%Y-%m-%d').month

        if month_from >= 9:
            academic_year_start = f"{year_from}-09-01"
        else:
            academic_year_start = f"{year_from - 1}-09-01"

        # Запрос для получения данных (упрощенный вариант)
        query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.cid,
                ns.gid,
                ns.teacher_mid,
                ns.period,
                ns.day_of_week,
                ns.pair_type_id,
                ns.idcathedra,
                nsv.sh_var_name,
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(
                            TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE DATE %s + (ns.day_of_week - 1) * INTERVAL '1 day'
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid IS NOT NULL
            AND array_length(ns.teacher_mid, 1) > 0
        ),
        filtered_schedule AS (
            SELECT *
            FROM schedule_data
            WHERE event_date BETWEEN %s AND %s
        )
        SELECT 
            p.mid as teacher_id,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS teacher_name,
            c.cathedra as cathedra_name,
            f.faculty as faculty_name,
            COUNT(CASE WHEN et.alias = 'Л' THEN 1 END) as lecture_count,
            COUNT(CASE WHEN et.alias = 'ПЗ' THEN 1 END) as practice_count,
            COUNT(CASE WHEN et.alias = 'С' THEN 1 END) as seminar_count,
            COUNT(CASE WHEN et.alias = 'ЛР' THEN 1 END) as lab_count,
            COUNT(CASE WHEN et.alias = 'Э' THEN 1 END) as exam_count,
            COUNT(CASE WHEN et.alias = 'КР' THEN 1 END) as control_count,
            COUNT(CASE WHEN et.alias = 'З' THEN 1 END) as test_count,
            COUNT(CASE WHEN et.alias = 'КуР' THEN 1 END) as course_work_count,
            COUNT(*) as total_lessons,
            COUNT(*) * 2 as total_hours
        FROM filtered_schedule fs
        JOIN people p ON p.mid = ANY(fs.teacher_mid)
        LEFT JOIN cathedras c ON fs.idcathedra = c.idcathedra
        JOIN courses cr ON fs.cid = cr.cid
        JOIN eventtools et ON fs.pair_type_id = et.typeid
        LEFT JOIN groupname gn ON fs.gid = gn.gid
        LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
        WHERE 1=1
        """

        params = [academic_year_start, academic_year_start, date_from, date_to]

        # Фильтрация по преподавателям
        if teacher_ids:
            teacher_ids_int = list(map(int, teacher_ids))
            teacher_placeholders = ','.join(['%s'] * len(teacher_ids_int))
            query += f" AND p.mid IN ({teacher_placeholders})"
            params.extend(teacher_ids_int)

        # Фильтрация по факультету
        if faculty_id != 'all':
            query += " AND f.idfaculty = %s"
            params.append(int(faculty_id))

        # Фильтрация по типам занятий
        if lesson_types:
            type_placeholders = ','.join(['%s'] * len(lesson_types))
            query += f" AND et.alias IN ({type_placeholders})"
            params.extend(lesson_types)

        query += """
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
                 c.cathedra, f.faculty
        ORDER BY teacher_name
        """

        workload_data = db.fetchall(query, tuple(params))

        # Создаем Excel файл
        wb = Workbook()
        ws = wb.active
        ws.title = "Нагрузка преподавателей"

        # Стили
        header_font = Font(bold=True, size=12)
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font_color = Font(color="FFFFFF", bold=True)
        center_alignment = Alignment(horizontal="center", vertical="center")
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )

        # Заголовок
        ws['A1'] = "Отчет по нагрузке преподавателей"
        ws['A1'].font = Font(bold=True, size=14)
        ws.merge_cells('A1:L1')
        ws['A1'].alignment = Alignment(horizontal="center")

        # Период
        ws['A2'] = f"Период: с {date_from} по {date_to}"
        ws.merge_cells('A2:L2')
        ws['A2'].alignment = Alignment(horizontal="center")

        # Заголовки столбцов
        headers = [
            "№", "ФИО преподавателя", "Кафедра", "Факультет",
            "Лекции (часы)", "Практич. (часы)", "Семинары (часы)",
            "Лаб.раб. (часы)", "Экзамены (часы)", "Контр.раб. (часы)",
            "Зачеты (часы)", "Курс.раб. (часы)", "Всего часов"
        ]

        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col, value=header)
            cell.font = header_font_color
            cell.fill = header_fill
            cell.alignment = center_alignment
            cell.border = border
            ws.column_dimensions[get_column_letter(col)].width = 20

        # Данные
        row = 5
        for idx, item in enumerate(workload_data, 1):
            # Рассчитываем часы (по 2 часа на занятие)
            lecture_hours = item['lecture_count'] * 2
            practice_hours = item['practice_count'] * 2
            seminar_hours = item['seminar_count'] * 2
            lab_hours = item['lab_count'] * 2
            exam_hours = item['exam_count'] * 2
            control_hours = item['control_count'] * 2
            test_hours = item['test_count'] * 2
            course_work_hours = item['course_work_count'] * 2

            total_hours = item['total_hours']

            data_row = [
                idx,
                item['teacher_name'],
                item['cathedra_name'] or '',
                item['faculty_name'] or '',
                lecture_hours,
                practice_hours,
                seminar_hours,
                lab_hours,
                exam_hours,
                control_hours,
                test_hours,
                course_work_hours,
                total_hours
            ]

            for col, value in enumerate(data_row, 1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = border
                if col >= 5:  # Числовые колонки
                    cell.alignment = Alignment(horizontal="center")

            row += 1

        # Итоги
        if workload_data:
            ws.cell(row=row, column=1, value="ИТОГО:").font = Font(bold=True)
            ws.cell(row=row, column=13, value=sum(item['total_hours'] for item in workload_data)).font = Font(bold=True)

            # Формулы для сумм по колонкам
            for col in range(5, 13):  # Колонки с часами
                col_letter = get_column_letter(col)
                ws.cell(row=row, column=col, value=f"=SUM({col_letter}5:{col_letter}{row - 1})").font = Font(bold=True)

        # Сохраняем в буфер
        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        # Формируем имя файла
        filename = f"нагрузка_преподавателей_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

        return send_file(
            buffer,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )

    except Exception as e:
        print(f"Error in export_excel: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
