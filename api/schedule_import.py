# -*- coding: utf-8 -*-
import re
from datetime import datetime, date
import openpyxl
from flask import Blueprint, request, jsonify, session
from db.database import DataBase

import_bp = Blueprint('import_api', __name__)


# ==================== УТИЛИТЫ ОЧИСТКИ ====================

def clean_cell_value(val):
    if val is None:
        return ""
    val_str = str(val).replace('\xa0', ' ').replace('\t', ' ')
    return re.sub(r'\s+', ' ', val_str).strip()


def parse_date(raw_date):
    """Парсит дату из ячейки. Возвращает datetime.date или None."""
    if isinstance(raw_date, datetime):
        return raw_date.date()
    if isinstance(raw_date, date):
        return raw_date
    if not raw_date:
        return None
    date_str = clean_cell_value(raw_date)
    for fmt in ('%Y-%m-%d', '%d.%m.%Y', '%d/%m/%Y', '%d.%m.%y', '%Y.%m.%d'):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            pass
    return None


def parse_lesson_num(val):
    """
    Парсит ТОЛЬКО формат '1-2', '3-4', '5-6', '7-8', '9-10', '11-12'.
    Не трогает числа типа 1180, 131, 1201 — это не номера пар.
    """
    if val is None:
        return None

    # Число — не номер пары (это группа, аудитория и т.п.)
    if isinstance(val, (int, float)):
        return None

    val_str = clean_cell_value(val)
    if not val_str:
        return None

    hour_to_pair = {
        '1-2': 1, '3-4': 2, '5-6': 3, '7-8': 4,
        '9-10': 5, '11-12': 6
    }

    # Нормализуем дефисы и пробелы
    normalized = re.sub(r'\s*-\s*', '-', val_str.strip())

    if normalized in hour_to_pair:
        return hour_to_pair[normalized]

    return None  # всё остальное — не номер пары


def parse_lesson_string(raw_str):
    """
    Парсит строку типа 'ДП-117_Л14 Тема: 3' или 'ДС-131/2_Пз13 Т: 4'.
    """
    if not raw_str:
        return None

    upper = raw_str.upper()
    if 'САМ' in upper and 'РАБОТА' in upper:
        return {'is_self_study': True}

    pattern = (
        r'^(?P<course>[А-Яа-яA-Za-z0-9\-\/,]+)'
        r'_'
        r'(?P<type>[А-Яа-яA-Za-z]+)'
        r'(?P<seq>\d+)?'
        r'(?:\s+Т(?:ема)?:?\s*(?P<topic>\d+))?'
    )
    match = re.match(pattern, raw_str.strip(), re.IGNORECASE)
    if match:
        data = match.groupdict()
        return {
            'is_self_study': False,
            'course_alias': data['course'].strip(),
            'type_code': data['type'].upper(),
            'lesson_seq': int(data['seq']) if data.get('seq') else None,
            'topic_num': int(data['topic']) if data.get('topic') else None
        }
    return None


def extract_room(cell_str):
    """Извлекает аудиторию из строки."""
    if not cell_str:
        return None
    # Убираем известные не-аудитории
    upper = cell_str.upper()
    if any(x in upper for x in ['ПРИСЯГА', 'УЧАСТИЕ', 'ВЫЕЗД', 'ТЕХНОЛОГИЧЕСКАЯ']):
        return None

    match = re.search(
        r'\b('
        r'\d+[кК]\d+'                # 1к168, 6к402
        r'|[А-Яа-яA-Za-z]{1,4}-\d+'  # ЛБ-22, КП-14, УК-12
        r'|\d+/\d+[кК]?\d*'          # 25/8к303
        r'|\d+[кКдД]\b'              # 8к, 5к
        r'|УЦА|УЦ-\d+|ЛБ-\d+'
        r'|спортзал|СПОРТЗАЛ|Бассейн|ПЛАЦ\s*\w*|КП-\d+[А-Яа-я]?'
        r'|БК-\d+|УК-\d+'
        r')\b',
        cell_str
    )
    return match.group(1) if match else None


# ==================== УЧЕБНЫЙ ГОД ====================

def get_academic_year_info(date_obj):
    """Определяет учебный год по дате."""
    year, month = date_obj.year, date_obj.month
    if month >= 9:
        study_year_start = year
    else:
        study_year_start = year - 1
    return {
        'study_year_start': study_year_start,
        'academic_year_start': f"{study_year_start}-09-01",
        'study_year_full': f"{study_year_start}-{study_year_start + 1}"
    }


def get_study_year_id(db, date_obj):
    """Получает school_year из studyyears по дате."""
    year_info = get_academic_year_info(date_obj)

    # По полному названию "2026-2027"
    result = db.fetchone(
        "SELECT school_year FROM studyyears WHERE name = %s",
        (year_info['study_year_full'],)
    )
    if result:
        return result['school_year']

    # По короткому номеру "26"
    result = db.fetchone(
        "SELECT school_year FROM studyyears WHERE number = %s",
        (str(year_info['study_year_start'])[-2:],)
    )
    if result:
        return result['school_year']

    # По числу
    result = db.fetchone(
        "SELECT school_year FROM studyyears WHERE school_year = %s",
        (year_info['study_year_start'],)
    )
    if result:
        return result['school_year']

    # Fallback
    result = db.fetchone("SELECT school_year FROM studyyears ORDER BY school_year DESC LIMIT 1")
    return result['school_year'] if result else None


# ==================== ВАРИАНТ РАСПИСАНИЯ ====================

def find_schedule_variant(db, date_obj, s_year_id, academic_year_start):
    """Находит sh_var_id для конкретной даты."""

    # Нормализация типа
    if isinstance(date_obj, datetime):
        date_obj = date_obj.date()

    # === Подход 1: точный диапазон дат в sh_var_name ===
    # Формат "Неделя X (DD.MM.YYYY - DD.MM.YYYY)" или "DD.MM.YYYY - DD.MM.YYYY"
    query = """
    WITH variants AS (
        SELECT sh_var_id, sh_var_name,
            CASE 
                WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                    TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                WHEN sh_var_name ~ '\\d{1,2}\\.\\d{2}\\.\\d{4}.*\\d{1,2}\\.\\d{2}\\.\\d{4}' THEN
                    TO_DATE(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), ' -', 1), 'DD.MM.YYYY')
                ELSE NULL
            END as week_start_date
        FROM nnz_schedule_variants
        WHERE s_year_id = %s AND sh_var_name IS NOT NULL
    )
    SELECT sh_var_id FROM variants
    WHERE week_start_date IS NOT NULL
      AND %s BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
    LIMIT 1
    """
    result = db.fetchone(query, (s_year_id, date_obj))
    if result:
        return result['sh_var_id']

    # === Подход 2: по номеру учебной недели ("Вариант расписания N неделя ...") ===
    # Определяем начало учебного года (1 сентября)
    if date_obj.month >= 9:
        start_of_year = date(date_obj.year, 9, 1)
    else:
        start_of_year = date(date_obj.year - 1, 9, 1)

    study_week = ((date_obj - start_of_year).days // 7) + 1
    print(f"  🔍 Дата {date_obj}, учебная неделя: {study_week}", flush=True)

    # Ищем "N неделя" в sh_var_name
    # Паттерн ищет "1 неделя", "2 неделя" и т.п.
    query = """
    SELECT sh_var_id, sh_var_name FROM nnz_schedule_variants
    WHERE s_year_id = %s 
      AND sh_var_name ILIKE %s
    LIMIT 1
    """
    # Важно: чтобы "1 неделя" не нашла "11 неделя", используем \y (граница слова) в regex
    # Но ILIKE проще: ищем "N неделя" с пробелом до и после
    for pattern in [
        f"%{study_week} неделя%",
        f"%расписания {study_week} неделя%",
        f"%Неделя {study_week}%",
    ]:
        result = db.fetchone(query, (s_year_id, pattern))
        if result:
            print(f"  ✅ Найдено: {result['sh_var_name']}", flush=True)
            return result['sh_var_id']

    # === Подход 3: по номеру недели в году (ISO) ===
    week_number = date_obj.isocalendar()[1]
    result = db.fetchone(
        "SELECT sh_var_id FROM nnz_schedule_variants WHERE s_year_id = %s AND sh_var_name ILIKE %s LIMIT 1",
        (s_year_id, f"%Неделя {week_number}%")
    )
    if result:
        return result['sh_var_id']

    # === Fallback ===
    print(f"  ⚠ Fallback: не найдено для {date_obj}, беру первый вариант", flush=True)
    result = db.fetchone(
        "SELECT sh_var_id FROM nnz_schedule_variants WHERE s_year_id = %s ORDER BY sh_var_id LIMIT 1",
        (s_year_id,)
    )
    return result['sh_var_id'] if result else None


# ==================== ПЕРИОД (ПАРА) ====================

def get_period_lid(db, s_year_id, pair_index):
    """Получает lid из periods по номеру пары (1-4) и учебному году."""
    if pair_index is None or pair_index < 1 or pair_index > 6:
        return None

    # По short_time = "N-я пара"
    result = db.fetchone(
        "SELECT lid FROM periods WHERE s_year_id = %s AND short_time LIKE %s LIMIT 1",
        (s_year_id, f"{pair_index}-я пара%")
    )
    if result:
        return result['lid']

    # Fallback: N-й период по порядку
    result = db.fetchone(
        "SELECT lid FROM periods WHERE s_year_id = %s ORDER BY starttime LIMIT 1 OFFSET %s",
        (s_year_id, pair_index - 1)
    )
    return result['lid'] if result else None


# ==================== ПОИСК В СПРАВОЧНИКАХ ====================

def find_event_type_id(db, type_code):
    """Ищет typeid по alias типа занятия."""
    if not type_code:
        return None

    # Точное совпадение alias
    result = db.fetchone(
        "SELECT typeid FROM eventtools WHERE UPPER(alias) = UPPER(%s) LIMIT 1",
        (type_code,)
    )
    if result:
        return result['typeid']

    # По typename
    result = db.fetchone(
        "SELECT typeid FROM eventtools WHERE UPPER(typename) LIKE UPPER(%s) LIMIT 1",
        (f"%{type_code}%",)
    )
    return result['typeid'] if result else None


def find_course_id(db, course_alias):
    """Ищет cid по alias курса."""
    if not course_alias:
        return None

    # Точное совпадение
    result = db.fetchone(
        "SELECT cid FROM courses WHERE UPPER(alias) = UPPER(%s) LIMIT 1",
        (course_alias,)
    )
    if result:
        return result['cid']

    # LIKE по alias
    result = db.fetchone(
        "SELECT cid FROM courses WHERE UPPER(alias) LIKE UPPER(%s) LIMIT 1",
        (f"%{course_alias}%",)
    )
    if result:
        return result['cid']

    # По title
    result = db.fetchone(
        "SELECT cid FROM courses WHERE UPPER(title) LIKE UPPER(%s) LIMIT 1",
        (f"%{course_alias}%",)
    )
    return result['cid'] if result else None


def find_teacher_mid(db, teacher_str):
    """Ищет mid преподавателя по строке из Excel."""
    if not teacher_str:
        return None

    clean = teacher_str.strip().upper()

    # Точное совпадение ФИО
    result = db.fetchone(
        """SELECT mid FROM people 
           WHERE UPPER(lastname || ' ' || firstname || ' ' || patronymic) = %s
           OR UPPER(lastname || ' ' || firstname) = %s
           LIMIT 1""",
        (clean, clean)
    )
    if result:
        return result['mid']

    # По фамилии (первое слово)
    parts = clean.split()
    if parts:
        lastname = parts[0]
        if len(lastname) > 2:
            result = db.fetchone(
                "SELECT mid FROM people WHERE UPPER(lastname) = %s LIMIT 1",
                (lastname,)
            )
            if result:
                return result['mid']

    # По фамилии + первой букве имени
    if len(parts) >= 2 and parts[1]:
        lastname = parts[0]
        first_initial = parts[1][0]
        result = db.fetchone(
            "SELECT mid FROM people WHERE UPPER(lastname) = %s AND UPPER(firstname) LIKE %s LIMIT 1",
            (lastname, f"{first_initial}%")
        )
        if result:
            return result['mid']

    return None


def find_room_rid(db, room_str):
    """Ищет rid аудитории."""
    if not room_str:
        return None
    result = db.fetchone(
        "SELECT rid FROM rooms WHERE UPPER(short_name) = UPPER(%s) OR UPPER(name) = UPPER(%s) LIMIT 1",
        (room_str, room_str)
    )
    if result:
        return result['rid']
    # LIKE
    result = db.fetchone(
        "SELECT rid FROM rooms WHERE UPPER(short_name) LIKE UPPER(%s) LIMIT 1",
        (f"%{room_str}%",)
    )
    return result['rid'] if result else None


# ==================== ПАРСЕР EXCEL ====================

def parse_excel_schedule(file_stream):
    """
    Парсит Excel с учётом шапки, где указаны группы.
    Группа и аудитория могут быть в одной ячейке: '1180   25/8к303'.
    """
    wb = openpyxl.load_workbook(file_stream, data_only=True)
    sheet = wb.active

    all_rows = list(sheet.iter_rows(values_only=True))

    # === ШАГ 1: находим строку с группами ===
    group_row_idx = None
    column_to_group = {}

    def extract_group_from_cell(cell_str):
        """Извлекает имя группы из ячейки типа '1180   25/8к303'."""
        if not cell_str:
            return None
        s = cell_str.strip()
        # Берём первое слово
        first_word = s.split()[0] if s.split() else ''
        # Проверяем паттерн группы:
        #   '1180', '41ПП', '2142', '10001', '2К', '2Е', '2Т'
        if re.match(r'^\d{3,5}$', first_word):
            return first_word
        if re.match(r'^\d{2,5}[А-Яа-яA-Za-z]{1,3}$', first_word):
            return first_word
        return None

    # Ищем строку, где ≥2 ячейки выглядят как группы
    for idx, row in enumerate(all_rows[:15]):
        if not row:
            continue
        candidates = []
        for col_idx, cell in enumerate(row):
            if cell is None:
                continue
            cell_str = clean_cell_value(cell)
            group_name = extract_group_from_cell(cell_str)
            if group_name:
                candidates.append((col_idx, group_name))

        if len(candidates) >= 2:
            group_row_idx = idx
            for col_idx, name in candidates:
                column_to_group[col_idx] = name
            break

    print(f"--- ШАПКА НАЙДЕНА В СТРОКЕ: {group_row_idx + 1 if group_row_idx is not None else 'НЕТ'} ---", flush=True)
    print(f"--- ГРУППЫ: {column_to_group} ---", flush=True)

    if not column_to_group:
        print("!!! НЕ УДАЛОСЬ НАЙТИ ШАПКУ С ГРУППАМИ !!!", flush=True)

    # === ШАГ 2: парсим пары ===
    parsed_rows = []
    current_date = None
    current_lesson_num = None
    current_by_group = {}

    def flush_current():
        nonlocal current_date, current_lesson_num, current_by_group
        if not current_date or current_lesson_num is None:
            return
        for group_name, cells in current_by_group.items():
            if cells:
                parsed_rows.append({
                    'date': current_date,
                    'day_of_week': current_date.isoweekday(),
                    'lesson_num': current_lesson_num,
                    'group_name': group_name,
                    'cells': cells
                })

    for row_idx, row in enumerate(all_rows, start=1):
        if not row or all(c is None for c in row):
            continue

        row_cells = [clean_cell_value(c) for c in row]

        row_date = parse_date(row_cells[0]) if len(row_cells) > 0 else None
        row_num = parse_lesson_num(row_cells[1]) if len(row_cells) > 1 else None

        # === Строка с датой ===
        if row_date:
            flush_current()
            current_date = row_date
            current_lesson_num = row_num
            current_by_group = {}
            for col_idx in range(2, len(row_cells)):
                cell = row_cells[col_idx]
                if not cell or cell == '_' or cell == '-':
                    continue
                group_name = column_to_group.get(col_idx)
                if group_name:
                    current_by_group.setdefault(group_name, []).append(cell)
            continue

        # === Строка с номером пары ===
        if row_num is not None and current_date:
            flush_current()
            current_lesson_num = row_num
            current_by_group = {}
            for col_idx in range(2, len(row_cells)):
                cell = row_cells[col_idx]
                if not cell or cell == '_' or cell == '-':
                    continue
                group_name = column_to_group.get(col_idx)
                if group_name:
                    current_by_group.setdefault(group_name, []).append(cell)
            continue

        # === Строка с данными (преподаватель, аудитория) ===
        if current_date and current_lesson_num is not None:
            for col_idx in range(len(row_cells)):
                cell = row_cells[col_idx]
                if not cell or cell == '_' or cell == '-':
                    continue
                group_name = column_to_group.get(col_idx)
                if group_name:
                    current_by_group.setdefault(group_name, []).append(cell)

    flush_current()

    print(f"--- РАСПОЗНАНО ПАР: {len(parsed_rows)} ---", flush=True)
    for r in parsed_rows[:10]:
        print(f"  {r['date']} | пара {r['lesson_num']} | гр. {r['group_name']} | cells: {r['cells'][:4]}", flush=True)
    return parsed_rows


# ==================== СИНХРОНИЗАЦИЯ С БД ====================

def sync_schedule_with_db(data):
    db = DataBase()
    inserted = updated = skipped = 0
    unmatched_groups = set()
    errors = []

    # Загружаем группы
    db_groups = db.fetchall("SELECT gid, name FROM groupname") or []
    cleaned_groups = sorted(
        [{'gid': g['gid'], 'name': clean_cell_value(g['name'])}
         for g in db_groups if clean_cell_value(g['name'])],
        key=lambda g: len(g['name']), reverse=True
    )

    study_year_cache = {}
    sh_var_cache = {}
    period_cache = {}

    for item in data:
        lesson_date = item['date']
        day_of_week = item['day_of_week']
        lesson_num = item['lesson_num']
        cells = item['cells']
        full_row_text = " ".join(cells)

        # === Пропускаем пустые ===
        if not cells:
            skipped += 1
            continue

        # === Пропускаем Сам.Работа ===
        upper_text = full_row_text.upper()
        if 'САМ.РАБОТА' in upper_text or 'САМОСТОЯТЕЛЬНАЯ' in upper_text:
            skipped += 1
            continue

        # === Пропускаем строки без реального предмета ===
        lesson_info = None
        for c in cells:
            if not c:
                continue
            p = parse_lesson_string(c)
            if p and not p.get('is_self_study'):
                lesson_info = p
                break

        if not lesson_info:
            skipped += 1
            continue

        # === 1. Учебный год ===
        if lesson_date not in study_year_cache:
            study_year_cache[lesson_date] = get_study_year_id(db, lesson_date)
        s_year_id = study_year_cache[lesson_date]
        if not s_year_id:
            errors.append(f"Нет учебного года для {lesson_date}")
            skipped += 1
            continue

        # === 2. sh_var_id ===
        if lesson_date not in sh_var_cache:
            sh_var_cache[lesson_date] = find_schedule_variant(
                db, lesson_date, s_year_id,
                get_academic_year_info(lesson_date)['academic_year_start']
            )
        sh_var_id = sh_var_cache[lesson_date]
        if not sh_var_id:
            errors.append(f"Нет варианта расписания для {lesson_date}")
            skipped += 1
            continue

        # === 3. period ===
        if s_year_id not in period_cache:
            period_cache[s_year_id] = {}
        if lesson_num not in period_cache[s_year_id]:
            period_cache[s_year_id][lesson_num] = get_period_lid(db, s_year_id, lesson_num)
        period_lid = period_cache[s_year_id][lesson_num]
        if not period_lid:
            errors.append(f"Нет периода для пары {lesson_num}, год {s_year_id}")
            skipped += 1
            continue

        # === 4. Группа — уже известна из парсера ===
        excel_group_name = item.get('group_name')
        if not excel_group_name:
            unmatched_groups.add(full_row_text[:150])
            skipped += 1
            continue

        matched_group_id = None
        for g in cleaned_groups:
            if g['name'].upper() == excel_group_name.upper():
                matched_group_id = g['gid']
                break

        # Частичное совпадение
        if not matched_group_id:
            for g in cleaned_groups:
                if g['name'].upper() in excel_group_name.upper() or \
                        excel_group_name.upper() in g['name'].upper():
                    matched_group_id = g['gid']
                    break

        if not matched_group_id:
            unmatched_groups.add(f"Группа '{excel_group_name}': {full_row_text[:100]}")
            skipped += 1
            continue

        # === 5. Преподаватель и аудитория ===
        teacher_candidate = None
        room_candidate = None

        for cell in cells:
            if not cell:
                continue
            if not room_candidate:
                rm = extract_room(cell)
                if rm:
                    room_candidate = rm
            if not teacher_candidate and len(cell) > 3:
                # ФИО — есть русские буквы, не похоже на предмет, не Сам.Работа
                if (re.search(r'[А-Яа-я]{3,}', cell)
                        and not parse_lesson_string(cell)
                        and 'ТЕХНОЛОГИЧЕСКАЯ' not in cell.upper()
                        and 'ПРАКТИКА' not in cell.upper()
                        and 'ПРИСЯГА' not in cell.upper()
                        and 'УЧАСТИЕ' not in cell.upper()
                        and 'ВЫЕЗД' not in cell.upper()):
                    teacher_candidate = cell

        # === 6. cid ===
        cid = find_course_id(db, lesson_info['course_alias'])
        if not cid:
            errors.append(f"Нет курса '{lesson_info['course_alias']}'")
            skipped += 1
            continue

        # === 7. pair_type_id ===
        pair_type_id = find_event_type_id(db, lesson_info['type_code'])
        if not pair_type_id:
            errors.append(f"Нет типа '{lesson_info['type_code']}'")
            skipped += 1
            continue

        # === 8. teacher_mid ===
        teacher_mid = find_teacher_mid(db, teacher_candidate) if teacher_candidate else None
        if not teacher_mid:
            errors.append(f"Нет преподавателя '{teacher_candidate}' для {lesson_info['course_alias']}")
            skipped += 1
            continue

        # === 9. rid ===
        rid = find_room_rid(db, room_candidate) if room_candidate else None
        rid_list = [rid] if rid else None

        # === 10. idcathedra ===
        cathedra_res = db.fetchone(
            "SELECT cid FROM cathedra_personnel WHERE mid = %s LIMIT 1",
            (teacher_mid,)
        )
        idcathedra = cathedra_res['cid'] if cathedra_res else 151

        # === 11. Upsert ===
        existing = db.fetchone("""
            SELECT sheid FROM nnz_schedule
            WHERE sh_var_id = %s AND period = %s AND day_of_week = %s
              AND gid = %s
              AND (lesson_num = %s OR (lesson_num IS NULL AND %s IS NULL))
        """, (sh_var_id, period_lid, day_of_week, matched_group_id, lesson_num, lesson_num))

        if not existing:
            result = db.execute_returning("""
                INSERT INTO nnz_schedule
                    (period, day_of_week, lesson_num, gid, teacher_mid, cid, rid,
                     pair_type_id, sh_var_id, idcathedra)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING sheid
            """, (
                period_lid, day_of_week, lesson_num, matched_group_id,
                [teacher_mid], cid, rid_list, pair_type_id, sh_var_id, idcathedra
            ))
            if result:
                inserted += 1
            else:
                errors.append(f"INSERT failed: {full_row_text[:80]}")
                skipped += 1
        else:
            db.execute("""
                UPDATE nnz_schedule
                SET teacher_mid = %s, cid = %s, rid = %s, pair_type_id = %s, idcathedra = %s
                WHERE sheid = %s
            """, ([teacher_mid], cid, rid_list, pair_type_id, idcathedra, existing['sheid']))
            updated += 1

    return {
        'inserted': inserted,
        'updated': updated,
        'skipped': skipped,
        'unmatched_samples': list(unmatched_groups)[:10],
        'errors': errors[:30]
    }


# ==================== ENDPOINT ====================
def debug_excel_head(file_stream):
    wb = openpyxl.load_workbook(file_stream, data_only=True)
    sheet = wb.active
    print("=" * 70, flush=True)
    print(f"Активный лист: {sheet.title}", flush=True)
    print(f"Всего строк: {sheet.max_row}, столбцов: {sheet.max_column}", flush=True)
    print("=" * 70, flush=True)
    for idx, row in enumerate(sheet.iter_rows(values_only=True), start=1):
        if idx > 10:
            break
        cells = [f"[{i}]{repr(c)[:30]}" for i, c in enumerate(row[:8])]
        print(f"Строка {idx}: {' | '.join(cells)}", flush=True)
    print("=" * 70, flush=True)

@import_bp.route('/api/schedule/import', methods=['POST'])
def import_schedule():
    if not session.get('is_admin'):
        return jsonify({'error': 'Доступ запрещен'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'Файл не выбран'}), 400

    file = request.files['file']
    if not file.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'error': 'Неверный формат файла'}), 400

    try:
        debug_excel_head(file.stream)  # ← добавь это
        file.stream.seek(0)
        schedule_data = parse_excel_schedule(file.stream)
        if not schedule_data:
            return jsonify({'error': 'Не найдено строк с датой и парой'}), 400

        stats = sync_schedule_with_db(schedule_data)

        # Подробный вывод в консоль
        print("=" * 70, flush=True)
        print(f"INSERTED: {stats['inserted']}", flush=True)
        print(f"UPDATED:  {stats['updated']}", flush=True)
        print(f"SKIPPED:  {stats['skipped']}", flush=True)
        print("-" * 70, flush=True)
        print("UNMATCHED GROUPS:", flush=True)
        for s in stats.get('unmatched_samples', []):
            print(f"  [X] {s}", flush=True)
        print("-" * 70, flush=True)
        print("ERRORS:", flush=True)
        for e in stats.get('errors', []):
            print(f"  [!] {e}", flush=True)
        print("=" * 70, flush=True)

        msg = (f"Импорт завершен! Добавлено: {stats['inserted']}, "
               f"Обновлено: {stats['updated']}, Пропущено: {stats['skipped']}")

        return jsonify({
            'success': True,
            'message': msg,
            'stats': stats,
            'unmatched_samples': stats.get('unmatched_samples', []),
            'errors': stats.get('errors', [])
        })
    except Exception as e:
        print(f"ОШИБКА ИМПОРТА: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"Ошибка: {str(e)}"}), 500


@import_bp.route('/api/schedule/imported', methods=['GET'])
def get_imported_schedules():
    """Показывает последние добавленные пары — для диагностики импорта."""
    # if not session.get('is_admin'):
    #     return jsonify({'error': 'Доступ запрещен'}), 403

    db = DataBase()
    s_year_id = request.args.get('s_year_id', 35, type=int)

    query = """
    SELECT 
        ns.sheid,
        ns.sh_var_id,
        nsv.sh_var_name AS variant_name,
        nsv.s_year_id   AS year_id,
        ns.day_of_week,
        ns.lesson_num,
        pr.short_time   AS period_name,
        gn.gid,
        gn.name         AS group_name,
        cr.cid,
        cr.alias        AS course_alias,
        cr.title        AS course_title,
        et.typeid,
        et.alias        AS type_alias,
        et.typename     AS type_name,
        ns.teacher_mid  AS teacher_mids,
        ns.rid          AS room_ids
    FROM nnz_schedule ns
    JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
    LEFT JOIN periods pr    ON ns.period = pr.lid
    LEFT JOIN groupname gn  ON ns.gid = gn.gid
    LEFT JOIN courses cr    ON ns.cid = cr.cid
    LEFT JOIN eventtools et ON ns.pair_type_id = et.typeid
    WHERE nsv.s_year_id = %s
    ORDER BY ns.sheid DESC
    LIMIT 200
    """

    rows = db.fetchall(query, (s_year_id,))

    # Подтягиваем имена преподавателей и аудиторий
    result = []
    for r in rows:
        teacher_names = []
        if r['teacher_mids']:
            for mid in r['teacher_mids']:
                p = db.fetchone(
                    "SELECT lastname || ' ' || firstname AS name FROM people WHERE mid = %s",
                    (mid,)
                )
                if p:
                    teacher_names.append(p['name'])

        room_names = []
        if r['room_ids']:
            for rid in r['room_ids']:
                rm = db.fetchone(
                    "SELECT short_name FROM rooms WHERE rid = %s",
                    (rid,)
                )
                if rm:
                    room_names.append(rm['short_name'])

        result.append({
            'sheid': r['sheid'],
            'sh_var_id': r['sh_var_id'],
            'variant_name': r['variant_name'],
            'year_id': r['year_id'],
            'day_of_week': r['day_of_week'],
            'lesson_num': r['lesson_num'],
            'period_name': r['period_name'],
            'group_id': r['gid'],
            'group_name': r['group_name'],
            'course_id': r['cid'],
            'course_alias': r['course_alias'],
            'course_title': r['course_title'],
            'type_id': r['typeid'],
            'type_alias': r['type_alias'],
            'type_name': r['type_name'],
            'teachers': teacher_names,
            'rooms': room_names,
        })

    return jsonify({
        'success': True,
        's_year_id': s_year_id,
        'count': len(result),
        'schedules': result
    })