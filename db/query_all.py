import json
from datetime import timedelta, datetime


def data_obj(db, js: bool = False):
    query = """
    SELECT 
        p.mid AS person_id, 
        p.lastname AS person_lastname, 
        p.firstname AS person_firstname, 
        p.patronymic AS person_patronymic, 
        crs.cid AS course_id, 
        crs.alias AS course_alias, 
        r.rid AS room_id, 
        r.short_name AS room_name, 
        e.typeid AS event_type_id, 
        e.alias AS event_type_alias, 
        g.gid AS group_id, 
        g.name AS group_name,
        (SELECT idfaculty FROM groupname WHERE gid = gn.gid) AS idfaculty,
        (SELECT \"shortName\" FROM fuculty WHERE idfaculty = (SELECT idfaculty FROM groupname WHERE gid = gn.gid)) AS short_name,  -- Добавляем shortName
        pr.name AS period_name,
        nnz_s.period AS period_id,
        nnz_s.sh_var_id AS sh_var_id, 
        nsv.sh_var_name AS sh_var_name, 
        nnz_s.day_of_week AS day_of_week,
        nnz_s.sh_var_id AS sh_var_id,
        nnz_s.sheid AS she_id,  -- Добавляем she_id
        nnz_s.teacher_mid AS teacher_id,
    	nnz_s.idcathedra AS id_cathedra,
        (SELECT studyyears.name FROM studyyears WHERE studyyears.school_year = nsv.s_year_id) AS study_year_name
    FROM public.nnz_schedule AS nnz_s
    JOIN people AS p ON p.mid = ANY(nnz_s.teacher_mid)  
    JOIN courses AS crs ON crs.cid = nnz_s.cid
    LEFT JOIN rooms AS r ON r.rid = ANY(nnz_s.rid)
    JOIN eventtools AS e ON nnz_s.pair_type_id = e.typeid
    JOIN groupname AS g ON nnz_s.gid = g.gid
    JOIN periods AS pr ON nnz_s.period = pr.lid 
    JOIN nnz_schedule_variants AS nsv ON nsv.sh_var_id = nnz_s.sh_var_id
    JOIN groupname AS gn ON gn.gid = nnz_s.gid
    ORDER BY p.lastname, pr.name;   
    """
    data = db.fetchall(query)
    # Упорядочиваем данные по нужному порядку
    order = ["1-2 час", "3-4 час", "5-6 час", "7-8 час"]
    subjectsByHour = [[] for _ in range(len(order))]
    for period in order:
        for row in data:
            #
            if row['period_name'] == period:
                hourIndex = order.index(period)
                # Извлекаем целочисленное значение XX из sh_var_name
                weekNumber = extract_week_number(row['sh_var_name'])

                subjectsByHour[hourIndex].append({
                    'person_id': str(row['person_id']),  # Добавляем ID человека
                    'course_id': str(row['course_id']),  # Добавляем course_id
                    'course_alias': str(row['course_alias']),
                    'room_id': str(row['room_id']) if row['room_id'] is not None else None,  # Добавляем room_id
                    'room_name': str(row['room_name']) if row['room_name'] is not None else None,
                    'event_type_id': str(row['event_type_id']),  # Добавляем event_type_id
                    'event_type_alias': str(row['event_type_alias']),
                    'group_id': str(row['group_id']),  # Добавляем group_id
                    'group_name': str(row['group_name']),
                    'short_name': str(row['short_name']),  # Добавляем shortName
                    'sh_var_id': str(row['sh_var_id']),  # Добавляем номер недели
                    'week_number': int(weekNumber),  # Добавляем целочисленное значение XX
                    'day_of_week': str(row['day_of_week']),  # Добавляем день недели
                    'study_year_name': int(row['study_year_name']),  # Добавляем название учебного года
                    'she_id': str(row['she_id']),  # Добавляем she_id
                    'teacher_id': str(set(row['teacher_id'])),  # Добавляем she_id
                    'id_cathedra': str(row['id_cathedra']),
                    'period_id': str(row['period_id']),  # Добавляем she_id
                })
    subjects = []

    for i in range(len(order)):
        subjects.append(subjectsByHour[i] if subjectsByHour[i] else [])

    return json.dumps(subjects) if not js else subjects


def get_data_all(db):
    disciplines = db.fetchall("SELECT cid AS id, alias, title FROM courses ORDER BY alias, title")
    classrooms = db.fetchall("SELECT rid AS id, short_name FROM rooms ORDER BY short_name")
    lessonTypes = db.fetchall("SELECT typeid AS id, alias FROM eventtools ORDER BY alias")
    groups = db.fetchall("SELECT gid AS id, name FROM groupname ORDER BY name")

    # Получение данных для ПМК 1
    groups_name_1 = db.fetchall("SELECT * FROM pmk WHERE id_pmk = 1")
    # Получение пользователей для ПМК 1
    users_1 = db.fetchall("""
                SELECT p.mid, p.lastname, p.firstname, p.patronymic, c_p.id_pmk
                FROM people AS p
                JOIN cathedra_personnel AS c_p ON p.mid = c_p.mid
                WHERE c_p.id_pmk = 1
            """)

    # Получение данных для ПМК 2 (если необходимо)
    groups_name_2 = db.fetchall("SELECT * FROM pmk WHERE id_pmk = 2")
    # Получение пользователей для ПМК 2
    users_2 = db.fetchall("""
                SELECT p.mid, p.lastname, p.firstname, p.patronymic, c_p.id_pmk
                FROM people AS p
                JOIN cathedra_personnel AS c_p ON p.mid = c_p.mid
                WHERE c_p.id_pmk = 2
            """)
    return locals()


def extract_week_number(sh_var_name):
    """
    Универсальная функция для извлечения номера недели из sh_var_name
    Обрабатывает форматы:
    - "Неделя 44 (23.06.2025 - 29.06.2025)"
    - "Вариант расписания 9 неделя 2025-2026"
    - "9 неделя"
    - "Неделя 44"
    """
    if not sh_var_name:
        return 0

    import re

    # Удаляем лишние пробелы
    text = sh_var_name.strip()

    # Пытаемся найти число после "Неделя" или "неделя"
    patterns = [
        r'Неделя\s+(\d+)',  # "Неделя 44"
        r'неделя\s+(\d+)',  # "9 неделя"
        r'Вариант расписания\s+(\d+)\s+неделя',  # "Вариант расписания 9 неделя"
        r'(\d+)\s+неделя',  # "9 неделя"
        r'\b(\d+)\b'  # Просто ищем любое число
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                return int(match.group(1))
            except (ValueError, IndexError):
                continue

    # Если ничего не нашли, возвращаем 0 или номер по умолчанию
    return 0


def get_study_year_for_date(date):
    """Определяет учебный год для указанной даты"""
    year = date.year
    month = date.month

    # Учебный год: с 1 сентября по 31 августа
    if month >= 9:  # Сентябрь-Декабрь
        return f"{year}-{year + 1}"
    else:  # Январь-Август
        return f"{year - 1}-{year}"


def get_week_bounds(year, month):
    """Получает границы недель для указанного месяца"""
    first_day = datetime(year, month, 1)

    # Находим первую неделю месяца
    first_week_start = first_day - timedelta(days=first_day.weekday())

    weeks = []
    current_week_start = first_week_start

    while current_week_start.month == month or (current_week_start + timedelta(days=6)).month == month:
        week_end = current_week_start + timedelta(days=6)
        weeks.append({
            'start': current_week_start,
            'end': week_end,
            'number': current_week_start.isocalendar()[1]  # ISO номер недели
        })
        current_week_start += timedelta(days=7)

    return weeks
