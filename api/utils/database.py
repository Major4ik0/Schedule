# -*- coding: utf-8 -*-

class TeacherDAO:
    """DAO для работы с преподавателями"""

    @staticmethod
    def get_by_full_name(db, full_name):
        query = "SELECT mid FROM people WHERE lastname || ' ' || firstname || ' ' || patronymic = %s"
        result = db.fetchone(query, (full_name,))
        return result['mid'] if result else None

    @staticmethod
    def get_by_ids(db, teacher_ids):
        query = """
        SELECT p.mid, p.lastname || ' ' || p.firstname || ' ' || p.patronymic as full_name
        FROM people p
        WHERE p.mid = ANY(%s)
        ORDER BY p.lastname, p.firstname
        """
        return db.fetchall(query, (teacher_ids,))

    @staticmethod
    def get_cathedra(db, teacher_mid, default=151):
        query = "SELECT cid FROM cathedra_personnel WHERE mid = %s LIMIT 1"
        result = db.fetchone(query, (teacher_mid,))
        return result['cid'] if result else default


class ScheduleDAO:
    """DAO для работы с расписанием"""

    @staticmethod
    def get_study_year_by_date(db, date_obj):
        """Определяет учебный год по дате"""
        year, month = date_obj.year, date_obj.month
        study_year_start = year if month >= 9 else year - 1

        query = "SELECT school_year FROM studyyears WHERE name = %s OR number = %s LIMIT 1"
        result = db.fetchone(query, (str(study_year_start), str(study_year_start)[-2:]))

        if not result:
            result = db.fetchone("SELECT school_year FROM studyyears ORDER BY school_year DESC LIMIT 1")

        return result['school_year'] if result else None

    @staticmethod
    def get_schedule_variant_by_date(db, date_obj, s_year_id, academic_year_start):
        """Находит вариант расписания по дате"""
        query = """
        WITH schedule_variants AS (
            SELECT 
                sh_var_id,
                CASE 
                    WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1), 'DD.MM.YYYY')
                    WHEN sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        DATE %s + (CAST(substring(sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                    ELSE NULL
                END as week_start_date
            FROM nnz_schedule_variants 
            WHERE s_year_id = %s AND sh_var_name IS NOT NULL
        )
        SELECT sh_var_id FROM schedule_variants
        WHERE week_start_date IS NOT NULL
          AND %s BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
        LIMIT 1
        """
        result = db.fetchone(query, (academic_year_start, s_year_id, date_obj.date()))
        return result['sh_var_id'] if result else None

    @staticmethod
    def get_schedule_by_id(db, schedule_id):
        query = "SELECT sheid, teacher_mid, sh_var_id, period, idcathedra FROM nnz_schedule WHERE sheid = %s"
        return db.fetchone(query, (schedule_id,))


class PeriodDAO:
    """DAO для работы с периодами (парами)"""

    # Fallback таблица для разных учебных годов
    PERIOD_FALLBACKS = {
        33: {0: 104, 1: 105, 2: 106, 3: 107},  # 2024-2025
        34: {0: 112, 1: 113, 2: 114, 3: 115},  # 2025-2026
        35: {0: 120, 1: 121, 2: 122, 3: 123},  # 2026-2027
    }
    DEFAULT_PERIOD = 112

    @staticmethod
    def get_by_pair_index(db, s_year_id, pair_index):
        """Получает ID периода по номеру пары и учебному году"""
        period_number = pair_index + 1
        period_pattern = f"{period_number}-я пара"

        query = "SELECT lid FROM periods WHERE s_year_id = %s AND short_time LIKE %s LIMIT 1"
        result = db.fetchone(query, (s_year_id, period_pattern))

        if result:
            return result['lid']

        # Используем fallback
        return PeriodDAO.PERIOD_FALLBACKS.get(s_year_id, {}).get(pair_index, PeriodDAO.DEFAULT_PERIOD)

    @staticmethod
    def get_periods_by_year(db, s_year_id):
        query = """
        SELECT lid, name, short_time, starttime, stoptime, s_year_id
        FROM periods
        WHERE s_year_id = %s
        ORDER BY starttime
        """
        return db.fetchall(query, (s_year_id,))


class EntityDAO:
    """Универсальный DAO для получения ID сущностей"""

    @staticmethod
    def get_id(db, table, id_field, name_field, value, entity_type):
        query = f"SELECT {id_field} FROM {table} WHERE {name_field} = %s"
        result = db.fetchone(query, (value,))
        if not result:
            raise ValueError(f'{entity_type} not found: {value}')
        return result[id_field]

    @staticmethod
    def get_all(db, table, id_field, name_field, order_by=None):
        query = f"SELECT {id_field} AS id, {name_field} FROM {table}"
        if order_by:
            query += f" ORDER BY {order_by}"
        return db.fetchall(query)