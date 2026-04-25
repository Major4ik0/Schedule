# -*- coding: utf-8 -*-
from datetime import datetime
import re


def get_academic_year_info(date_obj):
    """Возвращает информацию об учебном годе по дате"""
    year, month = date_obj.year, date_obj.month
    if month >= 9:
        return {
            'study_year_start': year,
            'academic_year_start': f"{year}-09-01",
            'study_year_str': str(year),
            'study_year_full': f"{year}-{year + 1}"
        }
    else:
        return {
            'study_year_start': year - 1,
            'academic_year_start': f"{year - 1}-09-01",
            'study_year_str': str(year - 1),
            'study_year_full': f"{year - 1}-{year}"
        }


def get_month_bounds(year, month):
    """Получает границы месяца"""
    from calendar import monthrange
    first_day = f"{year}-{month:02d}-01"
    last_day_num = monthrange(year, month)[1]
    last_day = f"{year}-{month:02d}-{last_day_num}"
    return first_day, last_day


def format_period_time(start_minutes, stop_minutes):
    """Форматирует время пары"""
    start_hour = start_minutes // 60
    start_min = start_minutes % 60
    stop_hour = stop_minutes // 60
    stop_min = stop_minutes % 60
    return f"{start_hour:02d}:{start_min:02d}-{stop_hour:02d}:{stop_min:02d}"


def extract_pair_number(short_time):
    """Извлекает номер пары из short_time"""
    match = re.search(r'(\d+)-я\s+пара', short_time)
    return int(match.group(1)) if match else None


def needs_higher_rank(pair_type):
    """Определяет, нужна ли высокая ученая степень для типа занятия"""
    if not pair_type:
        return False

    text = (pair_type.get('alias', '') + ' ' + pair_type.get('typename', '')).lower()
    lecture_keywords = ['лекц', 'лекция', 'lec']
    exam_keywords = ['зач', 'экз', 'зачет', 'экзамен']
    return any(kw in text for kw in lecture_keywords + exam_keywords)