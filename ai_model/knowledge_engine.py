# -*- coding: utf-8 -*-
# ai_model/knowledge_engine.py
"""
Knowledge Engine для AI-ассистента.
Извлекает и кэширует знания из существующих таблиц БД.
Автоматически обновляется при изменениях в расписании.
"""
import re
from datetime import datetime, timedelta
from collections import defaultdict


class KnowledgeEngine:
    """
    Извлекает структурированные знания из БД для быстрых ответов.
    Не требует обучения — работает на регулярных запросах с кэшированием.
    """

    def __init__(self, ttl_seconds=300):
        """
        Args:
            ttl_seconds: время жизни кэша (по умолчанию 5 минут)
        """
        self.ttl = ttl_seconds
        self._cache = {}
        self._cache_time = {}

    def _is_cache_valid(self, key):
        """Проверяет, актуален ли кэш"""
        if key not in self._cache_time:
            return False
        return (datetime.now() - self._cache_time[key]).seconds < self.ttl

    def _cache_get(self, key, fetcher):
        """Получает данные из кэша или загружает"""
        if self._is_cache_valid(key):
            return self._cache[key]

        data = fetcher()
        self._cache[key] = data
        self._cache_time[key] = datetime.now()
        return data

    def invalidate_cache(self):
        """Сбрасывает весь кэш (вызывать при изменениях в БД)"""
        self._cache = {}
        self._cache_time = {}
        print("Knowledge Engine cache invalidated")

    # ==================== ИЗВЛЕЧЕНИЕ ЗНАНИЙ ====================

    def get_group_info(self, group_number, db):
        """Получает информацию о группе"""

        def fetch():
            group = db.fetchone(
                """
                SELECT gn.gid, gn.name, gn.idfaculty, gn.idcathedra,
                       f.faculty, f."shortName" as faculty_short,
                       c.cathedra, c.shortname as cathedra_short
                FROM groupname gn
                LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
                LEFT JOIN cathedras c ON gn.idcathedra = c.idcathedra
                WHERE gn.name LIKE %s
                LIMIT 1
                """,
                (f'%{group_number}%',)
            )
            return dict(group) if group else None

        return self._cache_get(f'group_{group_number}', fetch)

    def get_teacher_info(self, name_part, db):
        """Получает информацию о преподавателе"""

        def fetch():
            # Убираем падежные окончания для поиска
            search = name_part.rstrip('аыиуе').rstrip('аыиуе').rstrip('аыиуе')
            print(f"DEBUG get_teacher_info: searching '{name_part}' -> '{search}'")

            teacher = db.fetchone(
                """
                SELECT p.mid, p.lastname, p.firstname, p.patronymic,
                       p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name,
                       ad.shortname as degree, ad.name as degree_full,
                       cp.id_pmk, pm.name_pmk,
                       c.cathedra, c.shortname as cathedra_short
                FROM people p
                LEFT JOIN academicdegree ad ON p.degree = ad.agid
                LEFT JOIN cathedra_personnel cp ON p.mid = cp.mid
                LEFT JOIN pmk pm ON cp.id_pmk = pm.id_pmk
                LEFT JOIN cathedras c ON cp.cid = c.idcathedra
                WHERE p.lastname ILIKE %s
                LIMIT 1
                """,
                (f'%{search}%',)
            )

            if not teacher:
                # Пробуем искать по началу фамилии
                teacher = db.fetchone(
                    """
                    SELECT p.mid, p.lastname, p.firstname, p.patronymic,
                           p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name,
                           ad.shortname as degree, ad.name as degree_full,
                           cp.id_pmk, pm.name_pmk,
                           c.cathedra, c.shortname as cathedra_short
                    FROM people p
                    LEFT JOIN academicdegree ad ON p.degree = ad.agid
                    LEFT JOIN cathedra_personnel cp ON p.mid = cp.mid
                    LEFT JOIN pmk pm ON cp.id_pmk = pm.id_pmk
                    LEFT JOIN cathedras c ON cp.cid = c.idcathedra
                    WHERE p.lastname ILIKE %s
                    LIMIT 1
                    """,
                    (f'{search}%',)
                )

            print(f"DEBUG get_teacher_info: found {teacher['full_name'] if teacher else None}")
            return dict(teacher) if teacher else None

        return self._cache_get(f'teacher_{name_part.lower()}', fetch)

    def get_next_lesson_for_group(self, group_id, db):
        def fetch():
            query = """
            WITH schedule_with_dates AS (
                SELECT 
                    ns.sheid, ns.cid, ns.gid, ns.period, ns.day_of_week,
                    nsv.sh_var_name,
                    CASE 
                        -- Формат 1: "Неделя 45 (30.06.2025 - 06.07.2025)"
                        WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                            TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            + (ns.day_of_week - 1) * INTERVAL '1 day'

                        -- Формат 2: "Вариант расписания 35 неделя 2025-2026"
                        WHEN nsv.sh_var_name ~* 'вариант расписания\\s+(\\d+)\\s+неделя' THEN
                            -- Вычисляем начало недели относительно начала учебного года
                            DATE (
                                CASE 
                                    WHEN SPLIT_PART(nsv.sh_var_name, ' ', 4) ~ '^\\d+$' 
                                    THEN (SPLIT_PART(nsv.sh_var_name, ' ', 5) || '-09-01')::DATE
                                    ELSE '2025-09-01'::DATE
                                END
                            ) + (
                                CAST(
                                    SUBSTRING(nsv.sh_var_name FROM 'Вариант расписания\\s+(\\d+)') AS INTEGER
                                ) - 1
                            ) * INTERVAL '1 week'
                            + (ns.day_of_week - 1) * INTERVAL '1 day'

                        ELSE NULL
                    END as event_date,
                    cr.alias as course_alias, cr.title as course_title,
                    et.alias as event_type, et.typename as event_type_full,
                    pr.short_time as period_name,
                    p.lastname || ' ' || p.firstname || ' ' || p.patronymic as teacher_name,
                    r.short_name as room_name
                FROM nnz_schedule ns
                JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
                JOIN courses cr ON ns.cid = cr.cid
                JOIN eventtools et ON ns.pair_type_id = et.typeid
                JOIN periods pr ON ns.period = pr.lid
                JOIN people p ON p.mid = ANY(ns.teacher_mid)
                LEFT JOIN rooms r ON r.rid = ANY(ns.rid)
                WHERE ns.gid = %s
            )
            SELECT * FROM schedule_with_dates
            WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY event_date, period_name
            LIMIT 1
            """
            lesson = db.fetchone(query, (group_id,))
            return dict(lesson) if lesson else None

        return self._cache_get(f'next_lesson_group_{group_id}', fetch)

    def get_next_lesson_for_teacher(self, teacher_mid, db):
        def fetch():
            query = """
            WITH schedule_with_dates AS (
                SELECT 
                    ns.sheid, ns.cid, ns.gid, ns.period, ns.day_of_week,
                    nsv.sh_var_name,
                    CASE 
                        -- Формат 1: "Неделя 45 (30.06.2025 - 06.07.2025)"
                        WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                            TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            + (ns.day_of_week - 1) * INTERVAL '1 day'

                        -- Формат 2: "Вариант расписания 35 неделя 2025-2026"
                        WHEN nsv.sh_var_name ~* 'вариант расписания\\s+(\\d+)\\s+неделя' THEN
                            DATE (
                                CASE 
                                    WHEN SPLIT_PART(nsv.sh_var_name, ' ', 4) ~ '^\\d+$' 
                                    THEN (SPLIT_PART(nsv.sh_var_name, ' ', 5) || '-09-01')::DATE
                                    ELSE '2025-09-01'::DATE
                                END
                            ) + (
                                CAST(
                                    SUBSTRING(nsv.sh_var_name FROM 'Вариант расписания\\s+(\\d+)') AS INTEGER
                                ) - 1
                            ) * INTERVAL '1 week'
                            + (ns.day_of_week - 1) * INTERVAL '1 day'

                        ELSE NULL
                    END as event_date,
                    cr.alias as course_alias, cr.title as course_title,
                    et.alias as event_type, et.typename as event_type_full,
                    pr.short_time as period_name,
                    gn.name as group_name,
                    r.short_name as room_name
                FROM nnz_schedule ns
                JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
                JOIN courses cr ON ns.cid = cr.cid
                JOIN eventtools et ON ns.pair_type_id = et.typeid
                JOIN periods pr ON ns.period = pr.lid
                JOIN groupname gn ON ns.gid = gn.gid
                LEFT JOIN rooms r ON r.rid = ANY(ns.rid)
                WHERE %s = ANY(ns.teacher_mid)
            )
            SELECT * FROM schedule_with_dates
            WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY event_date, period_name
            LIMIT 1
            """
            lesson = db.fetchone(query, (teacher_mid,))
            return dict(lesson) if lesson else None

        return self._cache_get(f'next_lesson_teacher_{teacher_mid}', fetch)

    def get_today_summary(self, db):
        """Получает сводку на сегодня"""
        today = datetime.now()

        if today.weekday() >= 5:  # Суббота или воскресенье
            return {'is_weekend': True, 'day_name': ['суббота', 'воскресенье'][today.weekday() - 5]}

        def fetch():
            from api.utils.helpers import get_academic_year_info
            from api.utils.database import ScheduleDAO

            year_info = get_academic_year_info(today)
            s_year_id = ScheduleDAO.get_study_year_by_date(db, today)

            if not s_year_id:
                return {'is_weekend': False, 'total_pairs': 0}

            # Ищем вариант расписания
            variant = db.fetchone("""
                WITH sv AS (
                    SELECT sh_var_id,
                        CASE 
                        -- Формат 1
                        WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                            TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                        
                        -- Формат 2
                        WHEN sh_var_name ~* 'вариант расписания\\s+(\\d+)\\s+неделя' THEN
                            DATE (
                                CASE 
                                    WHEN SPLIT_PART(sh_var_name, ' ', 4) ~ '^\\d+$' 
                                    THEN (SPLIT_PART(sh_var_name, ' ', 5) || '-09-01')::DATE
                                    ELSE '2025-09-01'::DATE
                                END
                            ) + (
                                CAST(SUBSTRING(sh_var_name FROM 'Вариант расписания\\s+(\\d+)') AS INTEGER) - 1
                            ) * INTERVAL '1 week'
                    
                        ELSE NULL
                    END as week_start
                    FROM nnz_schedule_variants
                    WHERE s_year_id = %s
                )
                SELECT sh_var_id FROM sv
                WHERE week_start IS NOT NULL
                  AND %s BETWEEN week_start AND week_start + INTERVAL '6 days'
                LIMIT 1
            """, (s_year_id, today.date()))

            if not variant:
                return {'is_weekend': False, 'total_pairs': 0}

            # Считаем пары
            day_of_week = today.isoweekday()
            count = db.fetchone(
                "SELECT COUNT(*) as cnt FROM nnz_schedule WHERE sh_var_id = %s AND day_of_week = %s",
                (variant['sh_var_id'], day_of_week)
            )

            # Детали пар
            pairs = db.fetchall("""
                SELECT 
                    cr.alias as course,
                    et.alias as type,
                    pr.short_time as period,
                    gn.name as group_name,
                    p.lastname || ' ' || p.firstname || ' ' || p.patronymic as teacher,
                    r.short_name as room
                FROM nnz_schedule ns
                JOIN courses cr ON ns.cid = cr.cid
                JOIN eventtools et ON ns.pair_type_id = et.typeid
                JOIN periods pr ON ns.period = pr.lid
                JOIN groupname gn ON ns.gid = gn.gid
                JOIN people p ON p.mid = ANY(ns.teacher_mid)
                LEFT JOIN rooms r ON r.rid = ANY(ns.rid)
                WHERE ns.sh_var_id = %s AND ns.day_of_week = %s
                ORDER BY pr.starttime
            """, (variant['sh_var_id'], day_of_week))

            return {
                'is_weekend': False,
                'total_pairs': count['cnt'] if count else 0,
                'pairs': [dict(p) for p in pairs] if pairs else []
            }

        return self._cache_get('today_summary', fetch)

    def get_teacher_workload(self, teacher_mid, db, days=30):
        """Получает нагрузку преподавателя за период"""

        def fetch():
            query = """
            WITH schedule_with_dates AS (
                SELECT 
                    ns.sheid, ns.cid, ns.period, ns.pair_type_id,
                    nsv.sh_var_name,
                    CASE 
                        WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                            TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            + (ns.day_of_week - 1) * INTERVAL '1 day'
                        ELSE NULL
                    END as event_date,
                    et.alias as event_type,
                    cr.alias as course_alias,
                    gn.name as group_name,
                    pr.short_time as period_name
                FROM nnz_schedule ns
                JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
                JOIN eventtools et ON ns.pair_type_id = et.typeid
                JOIN courses cr ON ns.cid = cr.cid
                JOIN groupname gn ON ns.gid = gn.gid
                JOIN periods pr ON ns.period = pr.lid
                WHERE %s = ANY(ns.teacher_mid)
            )
            SELECT * FROM schedule_with_dates
            WHERE event_date BETWEEN CURRENT_DATE - INTERVAL '%s days' AND CURRENT_DATE + INTERVAL '30 days'
            ORDER BY event_date
            """
            lessons = db.fetchall(query, (teacher_mid, days))
            return [dict(l) for l in lessons] if lessons else []

        return self._cache_get(f'workload_{teacher_mid}_{days}', fetch)

    def get_all_groups(self, db, limit=50):
        """Получает список всех групп"""

        def fetch():
            groups = db.fetchall(
                """
                SELECT gn.gid, gn.name, f.faculty, f."shortName" as faculty_short
                FROM groupname gn
                LEFT JOIN fuculty f ON gn.idfaculty = f.idfaculty
                ORDER BY gn.name
                LIMIT %s
                """,
                (limit,)
            )
            return [dict(g) for g in groups] if groups else []

        return self._cache_get('all_groups', fetch)

    def get_teacher_history(self, teacher_mid, db, course_id=None):
        """Получает историю преподавателя по дисциплинам"""

        def fetch():
            query = """
            SELECT 
                cr.cid, cr.alias, cr.title,
                COUNT(*) as total_count,
                COUNT(DISTINCT ns.gid) as group_count,
                COUNT(DISTINCT ns.pair_type_id) as type_count
            FROM nnz_schedule ns
            JOIN courses cr ON ns.cid = cr.cid
            WHERE %s = ANY(ns.teacher_mid)
            """
            params = [teacher_mid]

            if course_id:
                query += " AND ns.cid = %s"
                params.append(course_id)

            query += " GROUP BY cr.cid, cr.alias, cr.title ORDER BY total_count DESC LIMIT 20"

            history = db.fetchall(query, tuple(params))
            return [dict(h) for h in history] if history else []

        cache_key = f'teacher_history_{teacher_mid}_{course_id}'
        return self._cache_get(cache_key, fetch)

    def search_free_teachers(self, date_str, pair_index, db, cathedra_id=None):
        """Ищет свободных преподавателей на заданный слот"""

        def fetch():
            from api.utils.helpers import get_academic_year_info
            from api.utils.database import ScheduleDAO, PeriodDAO

            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            year_info = get_academic_year_info(date_obj)
            s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

            if not s_year_id:
                return []

            period_id = PeriodDAO.get_by_pair_index(db, s_year_id, pair_index)
            day_of_week = date_obj.isoweekday()

            # Ищем вариант расписания
            variant = db.fetchone("""
                WITH sv AS (
                    SELECT sh_var_id,
                        CASE 
                            WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                                TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            ELSE NULL
                        END as week_start
                    FROM nnz_schedule_variants
                    WHERE s_year_id = %s
                )
                SELECT sh_var_id FROM sv
                WHERE week_start IS NOT NULL
                  AND %s BETWEEN week_start AND week_start + INTERVAL '6 days'
                LIMIT 1
            """, (s_year_id, date_obj.date()))

            if not variant:
                return []

            # Занятые преподаватели
            busy = db.fetchall("""
                SELECT DISTINCT UNNEST(teacher_mid) as mid
                FROM nnz_schedule
                WHERE sh_var_id = %s AND period = %s AND day_of_week = %s
            """, (variant['sh_var_id'], period_id, day_of_week))

            busy_ids = [b['mid'] for b in busy] if busy else []

            # Все преподаватели (или по кафедре)
            if cathedra_id:
                all_teachers = db.fetchall("""
                    SELECT p.mid, p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name,
                           ad.shortname as degree, cp.id_pmk
                    FROM cathedra_personnel cp
                    JOIN people p ON p.mid = cp.mid
                    LEFT JOIN academicdegree ad ON p.degree = ad.agid
                    WHERE cp.cid = %s
                    ORDER BY p.lastname
                """, (cathedra_id,))
            else:
                all_teachers = db.fetchall("""
                    SELECT p.mid, p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name,
                           ad.shortname as degree, cp.id_pmk
                    FROM people p
                    JOIN cathedra_personnel cp ON p.mid = cp.mid
                    LEFT JOIN academicdegree ad ON p.degree = ad.agid
                    WHERE cp.id_pmk IN (1, 2)
                    ORDER BY p.lastname
                """)

            # Фильтруем свободных
            free = [dict(t) for t in all_teachers if t['mid'] not in busy_ids]
            return free

        return self._cache_get(f'free_teachers_{date_str}_{pair_index}_{cathedra_id}', fetch)

    def extract_number(self, text):
        """Извлекает номер группы/преподавателя из текста"""
        # Ищем 3-4 значное число (номер группы)
        match = re.search(r'\b(\d{3,4})\b', text)
        if match:
            return match.group(1)
        return None

    def extract_teacher_name(self, text):
        """Извлекает фамилию преподавателя из текста"""
        words = text.split()

        # Ключевые слова, после которых обычно идёт фамилия
        trigger_words = ['у', 'преподавател', 'преподавателя', 'препод', 'препода']

        for i, word in enumerate(words):
            clean_word = word.lower().strip('.,!?')
            if clean_word in trigger_words:
                # Берём следующие 1-3 слова
                for j in range(i + 1, min(i + 4, len(words))):
                    name_part = words[j].strip('.,!?')
                    # Проверяем: слово с большой буквы и длина > 3
                    if name_part[0].isupper() and len(name_part) > 3:
                        # Возвращаем фамилию в именительном падеже (убираем окончание)
                        return name_part.rstrip('а')

        # Если нет триггеров — ищем любое слово с большой буквы длиннее 3 символов
        for word in words:
            clean = word.strip('.,!?')
            if len(clean) > 3 and clean[0].isupper():
                # Убираем возможное окончание родительного падежа
                return clean.rstrip('а')

        return None


# Синглтон
knowledge_engine = KnowledgeEngine(ttl_seconds=300)  # кэш на 5 минут


def get_knowledge_engine():
    return knowledge_engine


def invalidate_knowledge_cache():
    """Вызывать после изменений в расписании (добавление/удаление/замена)"""
    knowledge_engine.invalidate_cache()