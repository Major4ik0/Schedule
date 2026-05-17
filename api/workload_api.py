# -*- coding: utf-8 -*-
import io
import re
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask import send_file

from .schedule_utils import DataBase

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False
    print("Warning: openpyxl not installed. Excel export will not work.")

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
        INNER JOIN cathedra_personnel AS cp ON p.mid = cp.mid
        LEFT JOIN cathedras AS c ON cp.cid = c.idcathedra
        LEFT JOIN pmk AS pm ON cp.id_pmk = pm.id_pmk
        LEFT JOIN academicdegree AS ad ON p.degree = ad.agid
        WHERE cp.id_pmk IN (1, 2)
        ORDER BY full_name
        """

        teachers = db.fetchall(query)

        formatted_teachers = []
        seen_ids = set()
        for teacher in teachers:
            if teacher['teacher_id'] not in seen_ids:
                seen_ids.add(teacher['teacher_id'])
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
        print(f"Error in getTeachers: {e}")
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
        ORDER BY faculty
        """

        faculties = db.fetchall(query)
        return jsonify(faculties)

    except Exception as e:
        print(f"Error in getFaculties: {e}")
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

        workload_response = get_workload()
        if workload_response.status_code != 200:
            return workload_response

        workload_result = workload_response.get_json()
        workload_data = workload_result.get('workload', [])

        wb = Workbook()
        ws = wb.active
        ws.title = "Нагрузка преподавателей"

        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font_color = Font(color="FFFFFF", bold=True)
        center_alignment = Alignment(horizontal="center", vertical="center")
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )

        ws['A1'] = "Отчет по нагрузке преподавателей"
        ws['A1'].font = Font(bold=True, size=14)
        ws.merge_cells('A1:M1')
        ws['A1'].alignment = Alignment(horizontal="center")

        ws[
            'A2'] = f"Период: {workload_result.get('period', {}).get('from', '')} - {workload_result.get('period', {}).get('to', '')}"
        ws.merge_cells('A2:M2')
        ws['A2'].alignment = Alignment(horizontal="center")

        headers = [
            "№", "ФИО преподавателя", "Кафедра", "Факультет",
            "Лекции", "Практич.", "Семинары", "Лаб.раб.",
            "Экзамены", "Зачеты", "Курс.раб.", "Всего занятий", "Всего часов"
        ]

        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col, value=header)
            cell.font = header_font_color
            cell.fill = header_fill
            cell.alignment = center_alignment
            cell.border = border
            ws.column_dimensions[get_column_letter(col)].width = 20

        row = 5
        for idx, item in enumerate(workload_data, 1):
            data_row = [
                idx,
                item['teacher_name'],
                item.get('cathedra', ''),
                item.get('faculty', ''),
                item.get('lectures', 0),
                item.get('practice', 0),
                item.get('seminars', 0),
                item.get('labs', 0),
                item.get('exams', 0),
                item.get('tests', 0),
                item.get('course_works', 0),
                item.get('total_lessons', 0),
                item.get('total_hours', 0)
            ]

            for col, value in enumerate(data_row, 1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = border
                if col >= 5:
                    cell.alignment = Alignment(horizontal="center")

            row += 1

        if workload_data:
            ws.cell(row=row, column=1, value="ИТОГО:").font = Font(bold=True)
            ws.cell(row=row, column=12, value=sum(item.get('total_lessons', 0) for item in workload_data)).font = Font(
                bold=True)
            ws.cell(row=row, column=13, value=sum(item.get('total_hours', 0) for item in workload_data)).font = Font(
                bold=True)

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

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


@workload_bp.route('/getFacultyColors', methods=['GET'])
def get_faculty_colors():
    """Получение цветов факультетов"""
    colors = {
        37: "#F19CBB",
        41: "#F19CBB",
        42: "#396a42",
        40: "#E5BE01",
        39: "#42AAFF",
        0: "#888888"  # Цвет для "Без факультета"
    }
    return jsonify(colors)


@workload_bp.route('/<int:teacher_id>/details', methods=['GET'])
def get_teacher_details(teacher_id):
    """Получение детальной нагрузки преподавателя с разбивкой по факультетам"""
    try:
        db = DataBase()

        teacher_query = """
        SELECT 
            p.mid,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree,
            c.cathedra as cathedra_name,
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

        date_from, date_to, year_start = get_academic_year_period()
        academic_year_start = date_from

        workload_query = """
        WITH schedule_data AS (
            SELECT 
                ns.sheid,
                ns.gid,
                ns.cid,
                ns.teacher_mid,
                ns.day_of_week,
                ns.pair_type_id,
                nsv.sh_var_name,
                CASE
                    WHEN nsv.sh_var_name ~ 'Неделя\\s+\\d+\\s*\\(' THEN
                        TO_DATE(
                            SUBSTRING(nsv.sh_var_name FROM '\\(''?([0-9]{2}\\.[0-9]{2}\\.[0-9]{4})'),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~ '[0-9]+\\s*недел' THEN
                        DATE %s + (CAST(SUBSTRING(nsv.sh_var_name FROM '([0-9]+)\\s*недел') AS INTEGER) - 1) * INTERVAL '1 week'
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    WHEN nsv.sh_var_name ~ '[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}' THEN
                        TO_DATE(
                            SUBSTRING(nsv.sh_var_name FROM '([0-9]{2}\\.[0-9]{2}\\.[0-9]{4})'),
                            'DD.MM.YYYY'
                        ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE NULL
                END as event_date
            FROM nnz_schedule ns
            JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.teacher_mid @> ARRAY[%s]::integer[]
        )
        SELECT 
            COALESCE(f.idfaculty, 0) as faculty_id,
            COALESCE(f.faculty, 'Без факультета') as faculty_name,
            f."shortName" as faculty_short,
            et.alias as lesson_type,
            et.typename as lesson_type_name,
            cr.alias as course_name,
            cr.title as course_title,
            gn.name as group_name,
            COUNT(*) as lessons_count,
            COUNT(*) * 2 as hours_count
        FROM schedule_data sd
        LEFT JOIN groupname gn ON sd.gid = gn.gid
        LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
        JOIN courses cr ON sd.cid = cr.cid
        JOIN eventtools et ON sd.pair_type_id = et.typeid
        WHERE sd.event_date IS NOT NULL
        AND sd.event_date BETWEEN %s AND %s
        GROUP BY f.idfaculty, f.faculty, f."shortName", et.alias, et.typename, cr.alias, cr.title, gn.name
        ORDER BY faculty_name, cr.alias
        """

        lessons_data = db.fetchall(workload_query, (academic_year_start, teacher_id, date_from, date_to))

        faculties_dict = {}

        for lesson in lessons_data:
            faculty_id_val = lesson['faculty_id'] if lesson['faculty_id'] is not None else 0
            faculty_name_val = lesson['faculty_name'] if lesson['faculty_name'] else 'Без факультета'

            if faculty_id_val not in faculties_dict:
                faculties_dict[faculty_id_val] = {
                    'faculty_id': faculty_id_val,
                    'faculty_name': faculty_name_val,
                    'faculty_short': lesson['faculty_short'],
                    'lectures': 0,
                    'practice': 0,
                    'seminars': 0,
                    'labs': 0,
                    'exams': 0,
                    'tests': 0,
                    'course_works': 0,
                    'controls': 0,
                    'total_hours': 0,
                    'total_lessons': 0,
                    'lessons': []
                }

            hours = lesson['hours_count']
            lessons = lesson['lessons_count']
            lesson_type = lesson['lesson_type']

            if lesson_type == 'Л':
                faculties_dict[faculty_id_val]['lectures'] += hours
            elif lesson_type == 'ПЗ':
                faculties_dict[faculty_id_val]['practice'] += hours
            elif lesson_type == 'С':
                faculties_dict[faculty_id_val]['seminars'] += hours
            elif lesson_type == 'ЛР':
                faculties_dict[faculty_id_val]['labs'] += hours
            elif lesson_type == 'Э':
                faculties_dict[faculty_id_val]['exams'] += hours
            elif lesson_type == 'З':
                faculties_dict[faculty_id_val]['tests'] += hours
            elif lesson_type == 'КуР':
                faculties_dict[faculty_id_val]['course_works'] += hours
            elif lesson_type == 'КР':
                faculties_dict[faculty_id_val]['controls'] += hours

            faculties_dict[faculty_id_val]['total_hours'] += hours
            faculties_dict[faculty_id_val]['total_lessons'] += lessons

            faculties_dict[faculty_id_val]['lessons'].append({
                'course_name': lesson['course_name'] or lesson['course_title'],
                'lesson_type': lesson['lesson_type_name'],
                'lesson_type_short': lesson['lesson_type'],
                'group_name': lesson['group_name'],
                'lessons_count': lessons,
                'hours': hours
            })

        colors = {
            37: "#F19CBB",
            41: "#F19CBB",
            42: "#396a42",
            40: "#E5BE01",
            39: "#42AAFF",
            0: "#888888"
        }

        for faculty_id_val in faculties_dict:
            faculties_dict[faculty_id_val]['color'] = colors.get(faculty_id_val, "#3b82f6")

        total_hours = sum(f['total_hours'] for f in faculties_dict.values())
        total_lessons = sum(f['total_lessons'] for f in faculties_dict.values())

        return jsonify({
            'teacher_info': {
                'id': teacher_info['mid'],
                'name': teacher_info['full_name'],
                'academic_degree': teacher_info['academic_degree'],
                'cathedra': teacher_info['cathedra_name'],
                'pmk': teacher_info['pmk_name']
            },
            'faculties': list(faculties_dict.values()),
            'total_hours': total_hours,
            'total_lessons': total_lessons
        })

    except Exception as e:
        print(f"Error in get_teacher_details: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def get_academic_year_period():
    """Возвращает начало и конец текущего учебного года (с 1 сентября по 31 августа)"""
    today = datetime.now()
    current_year = today.year
    current_month = today.month

    if current_month >= 9:
        year_start = current_year
        year_end = current_year + 1
    else:
        year_start = current_year - 1
        year_end = current_year

    date_from = f"{year_start}-09-01"
    date_to = f"{year_end}-08-31"

    return date_from, date_to, year_start


def get_base_workload_data(teacher_ids, faculty_id, lesson_types, date_from, date_to):
    """
    Базовый метод для получения данных о нагрузке.
    Возвращает список занятий с их преподавателями и факультетами.
    """
    db = DataBase()

    academic_year_start, _, _ = get_academic_year_period()

    query = """
    WITH schedule_data AS (
        SELECT 
            ns.sheid,
            ns.cid,
            ns.gid,
            ns.teacher_mid,
            ns.pair_type_id,
            ns.idcathedra,
            CASE
                WHEN nsv.sh_var_name ~ 'Неделя\\s+\\d+\\s*\\(' THEN
                    TO_DATE(
                        SUBSTRING(nsv.sh_var_name FROM '\\(''?([0-9]{2}\\.[0-9]{2}\\.[0-9]{4})'),
                        'DD.MM.YYYY'
                    ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                WHEN nsv.sh_var_name ~ '[0-9]+\\s*недел' THEN
                    DATE %s + (CAST(SUBSTRING(nsv.sh_var_name FROM '([0-9]+)\\s*недел') AS INTEGER) - 1) * INTERVAL '1 week'
                    + (ns.day_of_week - 1) * INTERVAL '1 day'
                WHEN nsv.sh_var_name ~ '[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}' THEN
                    TO_DATE(
                        SUBSTRING(nsv.sh_var_name FROM '([0-9]{2}\\.[0-9]{2}\\.[0-9]{4})'),
                        'DD.MM.YYYY'
                    ) + (ns.day_of_week - 1) * INTERVAL '1 day'
                ELSE NULL
            END as event_date
        FROM nnz_schedule ns
        JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
        WHERE ns.teacher_mid IS NOT NULL
        AND array_length(ns.teacher_mid, 1) > 0
    ),
    teacher_expanded AS (
        SELECT 
            sd.sheid,
            sd.cid,
            sd.gid,
            sd.pair_type_id,
            sd.event_date,
            sd.idcathedra,
            unnest(sd.teacher_mid) as teacher_id
        FROM schedule_data sd
        WHERE sd.event_date IS NOT NULL
        AND sd.event_date BETWEEN %s AND %s
    )
    SELECT 
        te.sheid,
        te.cid,
        te.gid,
        te.pair_type_id,
        te.idcathedra,
        te.event_date,
        te.teacher_id,
        p.lastname || ' ' || p.firstname || ' ' || p.patronymic as teacher_name,
        COALESCE(f.idfaculty, 0) as faculty_id,
        COALESCE(f.faculty, 'Без факультета') as faculty_name,
        cr.alias as course_name,
        et.alias as lesson_type,
        et.typename as lesson_type_name
    FROM teacher_expanded te
    JOIN people p ON p.mid = te.teacher_id
    LEFT JOIN groupname gn ON te.gid = gn.gid
    LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
    JOIN courses cr ON te.cid = cr.cid
    JOIN eventtools et ON te.pair_type_id = et.typeid
    WHERE 1=1
    """

    params = [academic_year_start, date_from, date_to]
    raw_lessons = db.fetchall(query, tuple(params))

    print(f"Found {len(raw_lessons)} raw lessons")

    result = []
    for lesson in raw_lessons:
        result.append({
            'sheid': lesson['sheid'],
            'event_date': lesson['event_date'],
            'teacher_id': lesson['teacher_id'],
            'teacher_name': lesson['teacher_name'],
            'faculty_id': lesson['faculty_id'],
            'faculty_name': lesson['faculty_name'],
            'course_name': lesson['course_name'],
            'lesson_type': lesson['lesson_type'],
            'lesson_type_name': lesson['lesson_type_name'],
            'hours': 2
        })

    print(f"After processing: {len(result)} lessons")

    # Фильтрация по преподавателям (только ПМК 1 и 2)
    if teacher_ids:
        teacher_ids_set = set(map(int, teacher_ids))
        result = [r for r in result if r['teacher_id'] in teacher_ids_set]
        print(f"After teacher filter: {len(result)} lessons")

    # Фильтрация по факультету
    if faculty_id != 'all':
        faculty_id_int = int(faculty_id)
        if faculty_id_int == 0:
            result = [r for r in result if r['faculty_id'] == 0]
        else:
            result = [r for r in result if r['faculty_id'] == faculty_id_int]
        print(f"After faculty filter: {len(result)} lessons")

    # Фильтрация по типам занятий
    if lesson_types:
        result = [r for r in result if r['lesson_type'] in lesson_types]
        print(f"After lesson type filter: {len(result)} lessons")

    # Выводим пример для отладки
    if result:
        print(
            f"Sample: teacher={result[0]['teacher_name']}, faculty={result[0]['faculty_name']}, type={result[0]['lesson_type']}")

    return result


@workload_bp.route('/getWorkload', methods=['POST'])
def get_workload():
    """Получение нагрузки преподавателей по фильтрам"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        teacher_ids = data.get('teachers', [])
        period_type = data.get('period', 'year')
        faculty_id = data.get('faculty', 'all')
        lesson_types = data.get('types', ['Л', 'ПЗ', 'ЛР', 'Э', 'С'])
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
            date_from, date_to, _ = get_academic_year_period()
        elif period_type == 'custom' and date_from and date_to:
            pass
        else:
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')

        print(f"Period: {date_from} - {date_to}")

        # Получаем базовые данные
        lessons = get_base_workload_data(teacher_ids, faculty_id, lesson_types, date_from, date_to)

        # Группируем по преподавателям и факультетам
        teacher_faculty_stats = {}

        for lesson in lessons:
            key = (lesson['teacher_id'], lesson['faculty_id'])
            if key not in teacher_faculty_stats:
                teacher_faculty_stats[key] = {
                    'teacher_id': lesson['teacher_id'],
                    'teacher_name': lesson['teacher_name'],
                    'faculty_id': lesson['faculty_id'],
                    'faculty_name': lesson['faculty_name'],
                    'lectures': 0,
                    'practice': 0,
                    'seminars': 0,
                    'labs': 0,
                    'exams': 0,
                    'controls': 0,
                    'tests': 0,
                    'course_works': 0,
                    'total_hours': 0,
                    'total_lessons': 0
                }

            lesson_type = lesson['lesson_type']
            hours = lesson['hours']

            if lesson_type == 'Л':
                teacher_faculty_stats[key]['lectures'] += hours
            elif lesson_type == 'ПЗ':
                teacher_faculty_stats[key]['practice'] += hours
            elif lesson_type == 'С':
                teacher_faculty_stats[key]['seminars'] += hours
            elif lesson_type == 'ЛР':
                teacher_faculty_stats[key]['labs'] += hours
            elif lesson_type == 'Э':
                teacher_faculty_stats[key]['exams'] += hours
            elif lesson_type == 'КР':
                teacher_faculty_stats[key]['controls'] += hours
            elif lesson_type == 'З':
                teacher_faculty_stats[key]['tests'] += hours
            elif lesson_type == 'КуР':
                teacher_faculty_stats[key]['course_works'] += hours

            teacher_faculty_stats[key]['total_hours'] += hours
            teacher_faculty_stats[key]['total_lessons'] += 1

        # Группируем по преподавателям для итоговой таблицы
        teacher_map = {}
        for key, stats in teacher_faculty_stats.items():
            teacher_id = stats['teacher_id']
            if teacher_id not in teacher_map:
                teacher_map[teacher_id] = {
                    'teacher_id': teacher_id,
                    'teacher_name': stats['teacher_name'],
                    'faculties': []
                }
            teacher_map[teacher_id]['faculties'].append({
                'faculty_name': stats['faculty_name'],
                'faculty_id': stats['faculty_id'],
                'lectures': stats['lectures'],
                'practice': stats['practice'],
                'seminars': stats['seminars'],
                'labs': stats['labs'],
                'exams': stats['exams'],
                'controls': stats['controls'],
                'tests': stats['tests'],
                'course_works': stats['course_works'],
                'total_hours': stats['total_hours'],
                'total_lessons': stats['total_lessons']
            })

        # Форматируем итоговые данные
        norm_hours = 150
        formatted_data = []
        total_hours_all = 0
        total_lessons_all = 0

        for teacher_id, teacher in teacher_map.items():
            total_hours = sum(f['total_hours'] for f in teacher['faculties'])
            total_lessons = sum(f['total_lessons'] for f in teacher['faculties'])

            total_hours_all += total_hours
            total_lessons_all += total_lessons

            lectures = sum(f['lectures'] for f in teacher['faculties'])
            practice = sum(f['practice'] for f in teacher['faculties'])
            seminars = sum(f['seminars'] for f in teacher['faculties'])
            labs = sum(f['labs'] for f in teacher['faculties'])
            exams = sum(f['exams'] for f in teacher['faculties'])
            controls = sum(f['controls'] for f in teacher['faculties'])
            tests = sum(f['tests'] for f in teacher['faculties'])
            course_works = sum(f['course_works'] for f in teacher['faculties'])

            # Основной факультет
            main_faculty = None
            main_faculty_id = None
            for f in teacher['faculties']:
                if f['faculty_id'] != 0:
                    main_faculty = f['faculty_name']
                    main_faculty_id = f['faculty_id']
                    break
            if not main_faculty:
                main_faculty = teacher['faculties'][0]['faculty_name'] if teacher['faculties'] else 'Без факультета'
                main_faculty_id = teacher['faculties'][0]['faculty_id'] if teacher['faculties'] else 0

            percentage = min(round((total_hours / norm_hours) * 100), 100) if norm_hours > 0 and total_hours > 0 else 0

            formatted_data.append({
                'teacher_id': teacher_id,
                'teacher_name': teacher['teacher_name'],
                'faculty': main_faculty,
                'faculty_id': main_faculty_id,
                'lectures': lectures,
                'practice': practice,
                'seminars': seminars,
                'labs': labs,
                'exams': exams,
                'controls': controls,
                'tests': tests,
                'course_works': course_works,
                'total_hours': total_hours,
                'total_lessons': total_lessons,
                'percentage': percentage,
                'faculties_detail': teacher['faculties']
            })

        formatted_data.sort(key=lambda x: x['teacher_name'])

        stats = {
            'totalHours': total_hours_all,
            'teacherCount': len(formatted_data),
            'totalLessons': total_lessons_all,
            'averageHours': round(total_hours_all / len(formatted_data), 1) if len(formatted_data) > 0 else 0
        }

        print(
            f"Stats: total_hours={stats['totalHours']}, total_lessons={stats['totalLessons']}, teachers={stats['teacherCount']}")

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
        print(f"Ошибка в getWorkload: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'workload': [],
            'stats': {
                'totalHours': 0,
                'teacherCount': 0,
                'totalLessons': 0,
                'averageHours': 0
            }
        }), 500


@workload_bp.route('/getMonthlyTrend', methods=['POST'])
def get_monthly_trend():
    """Получение реальных данных о динамике нагрузки по месяцам"""
    try:
        data = request.get_json()

        teacher_ids = data.get('teachers', [])
        faculty_id = data.get('faculty', 'all')
        lesson_types = data.get('types', [])  # ПОЛУЧАЕМ ТИПЫ ИЗ ЗАПРОСА

        date_from, date_to, _ = get_academic_year_period()

        # Получаем базовые данные с ТЕМИ ЖЕ типами, что и в основном запросе
        lessons = get_base_workload_data(teacher_ids, faculty_id, lesson_types, date_from, date_to)

        # Группируем по месяцам
        month_names = ['Сен', 'Окт', 'Ноя', 'Дек', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг']
        data_by_month = {i: 0 for i in range(12)}

        for lesson in lessons:
            if lesson['event_date']:
                month_num = lesson['event_date'].month
                if month_num >= 9:
                    idx = month_num - 9
                else:
                    idx = month_num + 3

                if 0 <= idx < 12:
                    data_by_month[idx] += lesson['hours']

        total_by_months = sum(data_by_month.values())

        print(f"Monthly trend - total hours: {total_by_months}, months data: {data_by_month}")

        return jsonify({
            'labels': month_names,
            'data': list(data_by_month.values()),
            'total_by_months': total_by_months
        })

    except Exception as e:
        print(f"Error in getMonthlyTrend: {e}")
        import traceback
        traceback.print_exc()
        month_names = ['Сен', 'Окт', 'Ноя', 'Дек', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг']
        return jsonify({
            'labels': month_names,
            'data': [0] * 12,
            'total_by_months': 0
        })


@workload_bp.route('/getWorkloadByFaculties', methods=['POST'])
def get_workload_by_faculties():
    """Получение нагрузки по преподавателям с группировкой по факультетам для графиков"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data received'}), 400

        teacher_ids = data.get('teachers', [])
        period_type = data.get('period', 'year')
        faculty_id = data.get('faculty', 'all')
        lesson_types = data.get('types', ['Л', 'ПЗ', 'ЛР', 'Э', 'С'])
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
            date_from, date_to, _ = get_academic_year_period()
        elif period_type == 'custom' and date_from and date_to:
            pass
        else:
            first_day = today.replace(day=1)
            last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            date_from = first_day.strftime('%Y-%m-%d')
            date_to = last_day.strftime('%Y-%m-%d')

        # Получаем базовые данные
        lessons = get_base_workload_data(teacher_ids, faculty_id, lesson_types, date_from, date_to)

        # Группируем по преподавателям и факультетам
        teacher_faculty_hours = {}

        for lesson in lessons:
            key = (lesson['teacher_id'], lesson['faculty_id'])
            if key not in teacher_faculty_hours:
                teacher_faculty_hours[key] = {
                    'teacher_id': lesson['teacher_id'],
                    'teacher_name': lesson['teacher_name'],
                    'faculty_id': lesson['faculty_id'],
                    'faculty_name': lesson['faculty_name'],
                    'total_hours': 0
                }
            teacher_faculty_hours[key]['total_hours'] += lesson['hours']

        # Группируем по факультетам
        faculties_data = {}
        for key, stats in teacher_faculty_hours.items():
            faculty_id_val = stats['faculty_id']
            if faculty_id_val not in faculties_data:
                faculties_data[faculty_id_val] = {
                    'faculty_id': faculty_id_val,
                    'faculty_name': stats['faculty_name'],
                    'teachers': []
                }

            faculties_data[faculty_id_val]['teachers'].append({
                'teacher_id': stats['teacher_id'],
                'teacher_name': stats['teacher_name'],
                'total_hours': stats['total_hours']
            })

        # Сортируем преподавателей по часам
        for faculty_id_val in faculties_data:
            faculties_data[faculty_id_val]['teachers'].sort(key=lambda x: x['total_hours'], reverse=True)

        total_hours_sum = sum(sum(t['total_hours'] for t in f['teachers']) for f in faculties_data.values())

        # Если выбран конкретный факультет
        if faculty_id != 'all':
            faculty_id_int = int(faculty_id)
            if faculty_id_int in faculties_data:
                return jsonify({
                    'type': 'single',
                    'faculty': faculties_data[faculty_id_int],
                    'all_faculties': list(faculties_data.values()),
                    'total_hours_sum': total_hours_sum
                })
            else:
                return jsonify({
                    'type': 'single',
                    'faculty': {
                        'faculty_id': faculty_id_int,
                        'faculty_name': 'Нет данных',
                        'teachers': []
                    },
                    'all_faculties': list(faculties_data.values()),
                    'total_hours_sum': total_hours_sum
                })

        return jsonify({
            'type': 'multiple',
            'faculties': list(faculties_data.values()),
            'total_hours_sum': total_hours_sum
        })

    except Exception as e:
        print(f"Ошибка в getWorkloadByFaculties: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@workload_bp.route('/getLessonTypes', methods=['GET'])
def get_lesson_types():
    """Получение всех типов занятий из базы данных"""
    try:
        db = DataBase()

        query = """
        SELECT 
            typeid,
            alias,
            typename
        FROM eventtools
        ORDER BY typename
        """

        types = db.fetchall(query)

        # Цвета для типов занятий
        colors = {
            'Л': '#3b82f6',
            'ПЗ': '#10b981',
            'С': '#8b5cf6',
            'ЛР': '#f59e0b',
            'Э': '#ef4444',
            'КуР': '#ec4899',
            'З': '#06b6d4',
            'КР': '#84cc16',
            'ГЗ': '#14b8a6',
            'ГУ': '#f97316',
            'ЛЗ': '#a855f7',
            'ЗЧ': '#ec4899',
            'ЭПр': '#6366f1'
        }

        result = []
        for t in types:
            result.append({
                'id': t['typeid'],
                'alias': t['alias'],
                'name': t['typename'],
                'color': colors.get(t['alias'], '#94a3b8'),
                'selected': True  # По умолчанию все типы выбраны
            })

        return jsonify(result)

    except Exception as e:
        print(f"Error in getLessonTypes: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
