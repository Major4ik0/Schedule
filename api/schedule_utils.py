# -*- coding: utf-8 -*-
import hashlib
import random
from datetime import datetime, timedelta
from functools import lru_cache

from db.database import DataBase


class ColorPaletteGenerator:
    def __init__(self):
        self.base_palette = [
            '#7c5cff', '#22c55e', '#3b82f6', '#f59e0b',
            '#ef4444', '#8b5cf6', '#10b981', '#06b6d4',
            '#d946ef', '#f97316', '#84cc16', '#14b8a6'
        ]

    def generate_palette(self, num_colors):
        """Генерирует палитру с заданным количеством цветов"""
        if num_colors <= len(self.base_palette):
            return self.base_palette[:num_colors]

        palette = self.base_palette.copy()
        needed_colors = num_colors - len(palette)

        for _ in range(needed_colors):
            color = self._generate_pleasant_color()
            palette.append(color)

        return palette

    def _generate_pleasant_color(self):
        """Генерирует приятный для глаз цвет"""
        h = random.randint(0, 360)
        s = random.randint(40, 80)
        l = random.randint(40, 70)
        return self.hsl_to_hex(h, s, l)

    def hsl_to_hex(self, h, s, l):
        """Конвертирует HSL в HEX"""
        h /= 360
        s /= 100
        l /= 100

        if s == 0:
            r = g = b = l
        else:
            def hue_to_rgb(p, q, t):
                if t < 0: t += 1
                if t > 1: t -= 1
                if t < 1 / 6: return p + (q - p) * 6 * t
                if t < 1 / 2: return q
                if t < 2 / 3: return p + (q - p) * (2 / 3 - t) * 6
                return p

            q = l * (1 + s) if l < 0.5 else l + s - l * s
            p = 2 * l - q
            r = hue_to_rgb(p, q, h + 1 / 3)
            g = hue_to_rgb(p, q, h)
            b = hue_to_rgb(p, q, h - 1 / 3)

        r = int(max(0, min(255, r * 255)))
        g = int(max(0, min(255, g * 255)))
        b = int(max(0, min(255, b * 255)))

        return f'#{r:02x}{g:02x}{b:02x}'


# Инициализируем генератор
color_generator = ColorPaletteGenerator()


def hash_string(s):
    """Хэширует строку для получения числового значения"""
    return int(hashlib.md5(s.encode('utf-8')).hexdigest()[:8], 16)


@lru_cache(maxsize=128)
def get_cached_palette(num_teachers):
    """Кэширует палитры для часто запрашиваемых количеств"""
    return color_generator.generate_palette(num_teachers)


def get_first_last_day_of_month(year, month):
    """Получить первый и последний день месяца"""
    first_day = datetime(year, month, 1)
    if month == 12:
        last_day = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = datetime(year, month + 1, 1) - timedelta(days=1)
    return f'{first_day}'.split()[0], f'{last_day}'.split()[0]


def format_schedule_data(data):
    """Форматирование данных расписания для фронтенда"""
    result = {}
    period_mapping = {'1-2 час': 0, '3-4 час': 1, '5-6 час': 2, '7-8 час': 3}
    for row in data:
        teacher_name = row['teacher_name']
        event_date = row['event_date']

        if teacher_name not in result:
            result[teacher_name] = {}

        if event_date not in result[teacher_name]:
            result[teacher_name][event_date] = [None, None, None, None]  # 4 пары

        pair_index = period_mapping.get(row['period_name'], 0)

        result[teacher_name][event_date][pair_index] = {
            'type': row['event_type'],
            'room': row['room_name'] or 'Ауд. не указана',
            'group': row['group_name'],
            'course': row['course_name'],
            'schedule_id': row['schedule_id'],
            'teacher_mid': row['teacher_mid'],
            'cid': row['cid'],
            'gid': row['gid'],
            'rid': row['rid'],
            'period': row['lid'],
            'cathedra_id': row.get('idcathedra', None),  # Добавляем ID кафедры
            'typeid': row.get('pair_type_id', None),  # Добавляем ID типа занятия
        }

    return result


def format_single_teacher_schedule(data):
    """Форматирование расписания для одного преподавателя"""
    result = {}
    period_mapping = {'1-2 час': 0, '3-4 час': 1, '5-6 час': 2, '7-8 час': 3}

    for row in data:
        event_date = row['event_date']

        if event_date not in result:
            result[event_date] = [None, None, None, None]

        pair_index = period_mapping.get(row['period_name'], 0)

        result[event_date][pair_index] = {
            'type': row['event_type'],
            'room': row['room_name'] or 'Ауд. не указана',
            'group': row['group_name'],
            'course': row['course_name'],
            'course_full': row.get('course_full_name', ''),
            'schedule_id': row['schedule_id'],
            'room_id': row.get('room_id'),
            'event_type_id': row.get('event_type_id'),
            'group_id': row.get('group_id'),
            'faculty': row.get('faculty_name', ''),
            'week_variant': row.get('sh_var_name', '')
        }

    return result


def calculate_week_number(event_date):
    """Вычисление номера недели в месяце"""
    first_day_of_month = event_date.replace(day=1)
    week_number = ((event_date - first_day_of_month).days // 7) + 1
    return week_number


def validate_schedule_data(data, required_fields):
    """Валидация данных расписания"""
    errors = []

    for field in required_fields:
        if field not in data or not data[field]:
            errors.append(f'Missing required field: {field}')

    if 'date' in data:
        try:
            datetime.strptime(data['date'], '%Y-%m-%d')
        except ValueError:
            errors.append('Invalid date format. Use YYYY-MM-DD')

    if 'pair_index' in data:
        pair_index = data['pair_index']
        if not isinstance(pair_index, int) or pair_index < 0 or pair_index > 3:
            errors.append('Invalid pair_index. Must be between 0 and 3')

    return errors


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

    text = sh_var_name.strip()

    patterns = [
        r'Неделя\s+(\d+)',
        r'неделя\s+(\d+)',
        r'Вариант расписания\s+(\d+)\s+неделя',
        r'(\d+)\s+неделя',
        r'\b(\d+)\b'
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                return int(match.group(1))
            except (ValueError, IndexError):
                continue

    return 0


def get_study_year_for_month(year, month):
    """Определяет учебный год для выбранного месяца"""
    # Учебный год: с 1 сентября текущего года по 31 августа следующего года
    if month >= 9:  # Сентябрь-Декабрь (9-12)
        study_year_start = year
        study_year_end = year + 1
    else:  # Январь-Август (1-8)
        study_year_start = year - 1
        study_year_end = year

    return f"{study_year_start}-{study_year_end}"


def get_study_year_id_for_month(year, month):
    """Получает ID учебного года из базы данных для выбранного месяца"""
    try:
        db = DataBase()
        study_year_str = get_study_year_for_month(year, month)

        # Пробуем найти по формату "2024-2025"
        query = "SELECT id FROM studyyears WHERE name = %s"
        result = db.fetchone(query, (study_year_str,))

        if result:
            return result['id']

        # Если не нашли, пробуем альтернативные форматы
        query = "SELECT id FROM studyyears WHERE name LIKE %s"
        result = db.fetchone(query, (f"%{study_year_str}%",))

        if result:
            return result['id']

        # Если все еще не нашли, берем самый последний учебный год
        query = "SELECT id FROM studyyears ORDER BY id DESC LIMIT 1"
        result = db.fetchone(query)

        if result:
            print(f"Warning: Using default study year ID {result['id']} for {study_year_str}")
            return result['id']

        return None

    except Exception as e:
        print(f"Error getting study year ID: {e}")
        return None
