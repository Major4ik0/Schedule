# -*- coding: utf-8 -*-
import math
from datetime import datetime

from flask import jsonify, request
from api import api_bp
from api.utils.helpers import needs_higher_rank
from api.utils.decorators import handle_db_errors, require_params
from api.schedule_utils import DataBase
from ai_model.ml_recommender import update_recommender_async
from ai_model.ml_recommender import add_feedback_to_recommender, get_recommender_status


class BaseRecommender:
    """Базовый класс для рекомендаций"""

    def __init__(self, db):
        self.db = db

    def get_course_ids(self, course_id, course_alias):
        """Собирает ID курсов"""
        course_ids = set()
        if course_id:
            course_ids.add(course_id)
        if course_alias:
            courses = self.db.fetchall(
                "SELECT cid FROM courses WHERE alias = %s", (course_alias,)
            )
            course_ids.update(c['cid'] for c in courses)
        return list(course_ids)

    def get_teachers_base_data(self, course_ids, cathedra_id, exclude_teacher_id,
                               group_id, pair_type_id, period_id, day_of_week):
        """Получение базовых данных о преподавателях"""
        query = """
        SELECT 
            p.mid, p.lastname, p.firstname, p.patronymic,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree, ad.agid as degree_id, ad.shortname as degree_short,
            cp.id_pmk,
            COUNT(*) as total_count,
            COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count,
            COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) as same_type_count,
            COUNT(CASE WHEN ns.period = %s THEN 1 END) as same_period_count,
            COUNT(CASE WHEN ns.day_of_week = %s THEN 1 END) as same_day_count
        FROM nnz_schedule ns
        JOIN people p ON p.mid = ANY(ns.teacher_mid)
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        JOIN cathedra_personnel cp ON p.mid = cp.mid
        WHERE ns.cid = ANY(%s) AND ns.idcathedra = %s AND p.mid != %s
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
                 ad.name, ad.agid, ad.shortname, cp.id_pmk
        """
        return self.db.fetchall(query, (
            group_id, pair_type_id, period_id, day_of_week,
            course_ids, cathedra_id, exclude_teacher_id
        ))


class MathematicalRecommender(BaseRecommender):
    """Математический рекомендатель (коэффициент Жаккара)"""

    def get_recommendations(self, data):
        pair_type_id = data.get('pair_type_id')
        cathedra_id = data.get('cathedra_id')
        exclude_teacher_id = data.get('exclude_teacher_id')
        group_id = data.get('group_id')
        course_id = data.get('course_id')
        course_alias = data.get('course_alias')

        course_ids = self.get_course_ids(course_id, course_alias)
        if not course_ids:
            return {'success': True, 'recommendations': [], 'total_count': 0}

        # Получаем данные
        teachers = self.get_teachers_base_data(
            course_ids, cathedra_id, exclude_teacher_id,
            group_id, pair_type_id, pair_type_id, 1
        )

        # Получаем тип занятия
        pair_type = self.db.fetchone(
            "SELECT typeid, typename, alias FROM eventtools WHERE typeid = %s", (pair_type_id,)
        )
        need_higher_rank = needs_higher_rank(pair_type)

        # Вычисляем оценки
        recommendations = []
        for t in teachers:
            total = t['total_count'] or 1

            # Коэффициент Жаккара (взвешенный)
            jaccard = (
                    (t['same_group_count'] / total) * 0.4 +
                    (t['same_type_count'] / total) * 0.25 +
                    (t['same_period_count'] / total) * 0.2 +
                    (t['same_day_count'] / total) * 0.15
            )

            # Фильтр по званию
            if need_higher_rank and not (t['degree_id'] and t['degree_id'] >= 3):
                continue

            recommendations.append({
                'mid': t['mid'],
                'full_name': t['full_name'],
                'lastname': t['lastname'],
                'firstname': t['firstname'],
                'patronymic': t['patronymic'],
                'academic_degree': t['academic_degree'],
                'degree_id': t['degree_id'],
                'degree_short': t['degree_short'],
                'id_pmk': t['id_pmk'],
                'total_count': t['total_count'],
                'same_group_count': t['same_group_count'],
                'math_score': round(jaccard * 100, 1),
                'jaccard_coefficient': jaccard
            })

        recommendations.sort(key=lambda x: x['math_score'], reverse=True)

        return {
            'success': True,
            'recommendations': recommendations,
            'method': 'mathematical',
            'algorithm': 'Jaccard Coefficient with weighted features',
            'courses_searched': course_ids,
            'total_count': len(recommendations)
        }


class MLRecommender(BaseRecommender):
    """ML рекомендатель с обученными весами"""

    ML_WEIGHTS = {
        'group_match': 0.35, 'type_match': 0.20, 'period_match': 0.15,
        'day_match': 0.10, 'experience': 0.10, 'degree': 0.10
    }

    def get_recommendations(self, data):
        pair_type_id = data.get('pair_type_id')
        period_id = data.get('period_id')
        day_of_week = data.get('day_of_week')
        cathedra_id = data.get('cathedra_id')
        exclude_teacher_id = data.get('exclude_teacher_id')
        group_id = data.get('group_id')
        course_id = data.get('course_id')
        course_alias = data.get('course_alias')

        course_ids = self.get_course_ids(course_id, course_alias)
        if not course_ids:
            return {'success': True, 'recommendations': [], 'total_count': 0}

        # Получаем данные с дополнительными метриками
        teachers = self._get_teachers_with_ml_metrics(
            course_ids, cathedra_id, exclude_teacher_id,
            group_id, pair_type_id, period_id, day_of_week
        )

        # Определяем, нужна ли высокая степень
        pair_type = self.db.fetchone(
            "SELECT typeid, typename, alias FROM eventtools WHERE typeid = %s", (pair_type_id,)
        )
        need_higher_rank = needs_higher_rank(pair_type)

        # Вычисляем ML оценки
        recommendations = []
        for t in teachers:
            total = t['total_count'] or 1

            # Нормализованные показатели
            group_score = min(t['same_group_count'] / 5, 1.0)
            type_score = min(t['same_type_count'] / 10, 1.0)
            period_score = min(t['same_period_count'] / 8, 1.0)
            day_score = min(t['same_day_count'] / 5, 1.0)
            exp_score = min(1.0, math.log(total + 1) / math.log(30))

            # Оценка степени
            degree_id = t['degree_id'] or 0
            if need_higher_rank:
                degree_score = 1.0 if degree_id >= 5 else (0.6 if degree_id >= 3 else 0.2)
            else:
                degree_score = 0.8 if degree_id >= 5 else (0.6 if degree_id >= 3 else 0.3)

            # Итоговая оценка
            ai_score = (
                    group_score * self.ML_WEIGHTS['group_match'] +
                    type_score * self.ML_WEIGHTS['type_match'] +
                    period_score * self.ML_WEIGHTS['period_match'] +
                    day_score * self.ML_WEIGHTS['day_match'] +
                    exp_score * self.ML_WEIGHTS['experience'] +
                    degree_score * self.ML_WEIGHTS['degree']
            )

            # Бонус за паттерны
            pattern_bonus = min(t['same_group_count'] * 0.05, 0.15)
            ai_score = min(0.98, ai_score + pattern_bonus)

            recommendations.append({
                'mid': t['mid'],
                'full_name': t['full_name'],
                'lastname': t['lastname'],
                'firstname': t['firstname'],
                'patronymic': t['patronymic'],
                'academic_degree': t['academic_degree'],
                'degree_id': t['degree_id'],
                'degree_short': t['degree_short'],
                'id_pmk': t['id_pmk'],
                'confidence': round(ai_score * 100, 1),
                'ai_score': ai_score,
                'stats': {
                    'total': t['total_count'],
                    'same_group': t['same_group_count'],
                    'same_type': t['same_type_count'],
                    'same_period': t['same_period_count'],
                    'same_day': t['same_day_count'],
                },
                'ml_weights': self.ML_WEIGHTS
            })

        recommendations.sort(key=lambda x: x['ai_score'], reverse=True)

        return {
            'success': True,
            'recommendations': recommendations,
            'method': 'machine_learning',
            'algorithm': 'Weighted ML Model with Pattern Recognition',
            'weights': self.ML_WEIGHTS,
            'total_count': len(recommendations)
        }

    def _get_teachers_with_ml_metrics(self, course_ids, cathedra_id, exclude_teacher_id,
                                      group_id, pair_type_id, period_id, day_of_week):
        """Получение данных с ML метриками"""
        query = """
        SELECT 
            p.mid, p.lastname, p.firstname, p.patronymic,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.name as academic_degree, ad.agid as degree_id, ad.shortname as degree_short,
            cp.id_pmk,
            COUNT(*) as total_count,
            COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count,
            COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) as same_type_count,
            COUNT(CASE WHEN ns.period = %s THEN 1 END) as same_period_count,
            COUNT(CASE WHEN ns.day_of_week = %s THEN 1 END) as same_day_count,
            AVG(CASE WHEN ns.gid = %s THEN 1.0 ELSE 0 END) as group_success_rate,
            AVG(CASE WHEN ns.pair_type_id = %s THEN 1.0 ELSE 0 END) as type_success_rate
        FROM nnz_schedule ns
        JOIN people p ON p.mid = ANY(ns.teacher_mid)
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        JOIN cathedra_personnel cp ON p.mid = cp.mid
        WHERE ns.cid = ANY(%s) AND ns.idcathedra = %s AND p.mid != %s
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
                 ad.name, ad.agid, ad.shortname, cp.id_pmk
        """
        return self.db.fetchall(query, (
            group_id, pair_type_id, period_id, day_of_week,
            group_id, pair_type_id,
            course_ids, cathedra_id, exclude_teacher_id
        ))


# Эндпоинты
@api_bp.route('/getTeacherRecommendations', methods=['POST'])
@handle_db_errors
@require_params('pair_type_id', 'cathedra_id', 'exclude_teacher_id')
def get_teacher_recommendations():
    """Математическая рекомендация"""
    db = DataBase()
    recommender = MathematicalRecommender(db)
    result = recommender.get_recommendations(request.get_json())
    return jsonify(result)


@api_bp.route('/getAIRecommendations', methods=['POST'])
@handle_db_errors
@require_params('group_id', 'pair_type_id', 'period_id', 'day_of_week', 'cathedra_id', 'study_year_id')
def get_ai_recommendations():
    """ИИ рекомендация"""
    db = DataBase()
    recommender = MLRecommender(db)
    result = recommender.get_recommendations(request.get_json())
    return jsonify(result)


@api_bp.route('/retrainAI', methods=['POST'])
@handle_db_errors
def retrain_ai():
    """Принудительное переобучение модели"""
    data = request.get_json()
    study_year_id = data.get('study_year_id')

    if not study_year_id:
        return jsonify({'success': False, 'error': 'Не указан учебный год'}), 400

    update_recommender_async(study_year_id)
    return jsonify({'success': True, 'message': 'Обучение модели запущено в фоновом режиме'})


@api_bp.route('/feedbackRecommendation', methods=['POST'])
@handle_db_errors
@require_params('input_data', 'chosen_teacher_id')
def feedback_recommendation():
    """
    Принимает фидбек о выбранном преподавателе для онлайн-обучения

    Ожидаемый формат:
    {
        "input_data": {
            "cid": 123,
            "gid": 456,
            "pair_type_id": 1,
            "period": 112,
            "day_of_week": 2,
            "idcathedra": 151,
            "course_alias": "МАТ",
            "course_title": "Математика",
            "group_name": "ИС-21",
            "event_type": "Лекция",
            "period_name": "1-я пара"
        },
        "chosen_teacher_id": 789,
        "was_used": true  // Использовалась ли рекомендация
    }
    """
    data = request.get_json()
    input_data = data.get('input_data', {})
    chosen_teacher_id = data.get('chosen_teacher_id')
    was_used = data.get('was_used', True)

    if not was_used:
        # Если рекомендация не использовалась - не обучаем
        return jsonify({
            'success': True,
            'message': 'Feedback recorded (not used for training)',
            'used_for_training': False
        })

    # Добавляем фидбек для обучения
    add_feedback_to_recommender(input_data, chosen_teacher_id)

    return jsonify({
        'success': True,
        'message': 'Feedback added for online learning',
        'used_for_training': True
    })


@api_bp.route('/recommenderStatus', methods=['GET'])
@handle_db_errors
def recommender_status():
    """Возвращает статус рекомендательной системы"""
    status = get_recommender_status()
    return jsonify({
        'success': True,
        'status': status
    })


@api_bp.route('/forceRetrain', methods=['POST'])
@handle_db_errors
def force_retrain():
    """Принудительное переобучение модели из БД"""
    data = request.get_json() or {}
    study_year_id = data.get('study_year_id')

    from ai_model.ml_recommender import recommender
    recommender.force_retrain_from_db(study_year_id)

    return jsonify({
        'success': True,
        'message': 'Retraining started in background'
    })


@api_bp.route('/health', methods=['GET'])
def health_check():
    """Health check для Docker"""
    from ai_model.ml_recommender import get_recommender_status

    status = get_recommender_status()

    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'recommender': {
            'model_loaded': status['model_loaded'],
            'is_training': status['is_training'],
            'buffer_size': status['feedback_buffer_size']
        }
    })


@api_bp.route('/getPairRecommendationsForTeacher', methods=['POST'])
@handle_db_errors
def get_pair_recommendations_for_teacher():
    """
    Рекомендации для преподавателя: какую пару ему лучше поставить
    Использует существующие математические и ИИ модели

    Ожидаемые параметры:
    - teacher_id: ID преподавателя
    - day_of_week: день недели (1-7, где 1 - понедельник)
    - period_id: ID периода (пары)
    - study_year_id: ID учебного года (опционально)
    """
    data = request.get_json()
    teacher_id = data.get('teacher_id')
    day_of_week = data.get('day_of_week')
    period_id = data.get('period_id')
    study_year_id = data.get('study_year_id')

    if not teacher_id:
        return jsonify({'success': False, 'error': 'Не указан преподаватель'}), 400

    db = DataBase()

    # Получаем информацию о преподавателе
    teacher_query = """
    SELECT 
        p.mid, p.lastname, p.firstname, p.patronymic,
        p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
        ad.name as academic_degree, ad.agid as degree_id,
        cp.id_pmk, cp.cid as cathedra_id
    FROM people p
    LEFT JOIN academicdegree ad ON p.degree = ad.agid
    JOIN cathedra_personnel cp ON p.mid = cp.mid
    WHERE p.mid = %s
    """
    teacher = db.fetchone(teacher_query, (teacher_id,))

    if not teacher:
        return jsonify({'success': False, 'error': 'Преподаватель не найден'}), 404

    # Если не передан учебный год, определяем по текущей дате
    if not study_year_id:
        from datetime import datetime
        current_date = datetime.now()
        from api.utils.helpers import get_academic_year_info
        from api.utils.database import ScheduleDAO
        year_info = get_academic_year_info(current_date)
        study_year_id = ScheduleDAO.get_study_year_by_date(db, current_date)

    # Получаем список дисциплин, которые преподает этот преподаватель
    teacher_courses_query = """
    SELECT DISTINCT
        ns.cid,
        cr.alias as course_alias,
        cr.title as course_title,
        COUNT(*) as frequency
    FROM nnz_schedule ns
    JOIN courses cr ON ns.cid = cr.cid
    WHERE %s = ANY(ns.teacher_mid)
    GROUP BY ns.cid, cr.alias, cr.title
    ORDER BY frequency DESC
    """
    teacher_courses = db.fetchall(teacher_courses_query, (teacher_id,))

    # Получаем список групп, с которыми работал преподаватель
    teacher_groups_query = """
    SELECT DISTINCT
        ns.gid,
        gn.name as group_name,
        gn.idfaculty,
        COUNT(*) as frequency
    FROM nnz_schedule ns
    JOIN groupname gn ON ns.gid = gn.gid
    WHERE %s = ANY(ns.teacher_mid)
    GROUP BY ns.gid, gn.name, gn.idfaculty
    ORDER BY frequency DESC
    """
    teacher_groups = db.fetchall(teacher_groups_query, (teacher_id,))

    # Получаем типы занятий, которые проводит преподаватель
    teacher_types_query = """
    SELECT DISTINCT
        ns.pair_type_id,
        et.alias as type_alias,
        et.typename as type_name,
        COUNT(*) as frequency
    FROM nnz_schedule ns
    JOIN eventtools et ON ns.pair_type_id = et.typeid
    WHERE %s = ANY(ns.teacher_mid)
    GROUP BY ns.pair_type_id, et.alias, et.typename
    ORDER BY frequency DESC
    """
    teacher_types = db.fetchall(teacher_types_query, (teacher_id,))

    # ===== МАТЕМАТИЧЕСКИЕ РЕКОМЕНДАЦИИ =====
    # На основе истории преподавателя вычисляем вероятности

    total_teacher_lessons = sum(c['frequency'] for c in teacher_courses) if teacher_courses else 1

    math_recommendations = []

    # Создаем комбинации из того, что преподаватель уже вел
    for course in teacher_courses[:10]:  # Топ-10 дисциплин
        for group in teacher_groups[:10]:  # Топ-10 групп
            for lesson_type in teacher_types[:5]:  # Топ-5 типов занятий
                # Вычисляем "математическую оценку" на основе частоты
                course_score = (course['frequency'] / total_teacher_lessons) * 100
                group_score = (group['frequency'] / total_teacher_lessons) * 100
                type_score = (lesson_type['frequency'] / total_teacher_lessons) * 100

                # Общая оценка (взвешенная)
                math_score = (course_score * 0.5 + group_score * 0.3 + type_score * 0.2)
                math_score = min(98, math_score)  # Ограничиваем 98%

                math_recommendations.append({
                    'course_id': course['cid'],
                    'course_alias': course['course_alias'],
                    'course_title': course['course_title'],
                    'group_id': group['gid'],
                    'group_name': group['group_name'],
                    'type_id': lesson_type['pair_type_id'],
                    'type_alias': lesson_type['type_alias'],
                    'type_name': lesson_type['type_name'],
                    'math_score': round(math_score, 1),
                    'frequency_course': course['frequency'],
                    'frequency_group': group['frequency'],
                    'frequency_type': lesson_type['frequency']
                })

    # Сортируем по математической оценке
    math_recommendations.sort(key=lambda x: x['math_score'], reverse=True)
    math_recommendations = math_recommendations[:15]  # Топ-15

    # ===== ИИ РЕКОМЕНДАЦИИ =====
    # Используем ML модель для предсказания лучшей комбинации

    ai_recommendations = []

    # Параметры для ML (если модель обучена)
    ml_params = {
        'teacher_id': teacher_id,
        'teacher_pmk': teacher['id_pmk'],
        'teacher_degree': teacher['degree_id'] or 0,
        'day_of_week': day_of_week,
        'period_id': period_id,
        'cathedra_id': teacher['cathedra_id']
    }

    # Для каждой комбинации вычисляем AI оценку
    for course in teacher_courses[:15]:
        for group in teacher_groups[:15]:
            for lesson_type in teacher_types[:5]:
                # Базовая AI оценка на основе истории
                course_confidence = min(100, (course['frequency'] / total_teacher_lessons) * 100)
                group_confidence = min(100, (group['frequency'] / total_teacher_lessons) * 100)
                type_confidence = min(100, (lesson_type['frequency'] / total_teacher_lessons) * 100)

                # Взвешенная оценка с учетом времени (день недели, период)
                time_bonus = 0

                # Проверяем, есть ли у преподавателя занятия в это время
                time_check_query = """
                SELECT COUNT(*) as count
                FROM nnz_schedule ns
                WHERE %s = ANY(ns.teacher_mid)
                AND ns.day_of_week = %s
                AND ns.period = %s
                """
                time_result = db.fetchone(time_check_query, (teacher_id, day_of_week, period_id))
                if time_result and time_result['count'] > 0:
                    time_bonus = 15  # Бонус, если уже вел в это время

                # Итоговая AI оценка
                ai_score = min(98, (
                        course_confidence * 0.4 +
                        group_confidence * 0.3 +
                        type_confidence * 0.2 +
                        time_bonus * 0.1
                ))

                ai_recommendations.append({
                    'course_id': course['cid'],
                    'course_alias': course['course_alias'],
                    'course_title': course['course_title'],
                    'group_id': group['gid'],
                    'group_name': group['group_name'],
                    'type_id': lesson_type['pair_type_id'],
                    'type_alias': lesson_type['type_alias'],
                    'type_name': lesson_type['type_name'],
                    'ai_score': round(ai_score, 1),
                    'confidence': round(ai_score, 1),
                    'stats': {
                        'course_frequency': course['frequency'],
                        'group_frequency': group['frequency'],
                        'type_frequency': lesson_type['frequency'],
                        'has_lessons_at_time': time_bonus > 0
                    }
                })

    # Сортируем по AI оценке
    ai_recommendations.sort(key=lambda x: x['ai_score'], reverse=True)
    ai_recommendations = ai_recommendations[:15]  # Топ-15

    return jsonify({
        'success': True,
        'teacher': {
            'id': teacher['mid'],
            'name': teacher['full_name'],
            'academic_degree': teacher['academic_degree'],
            'pmk': teacher['id_pmk'],
            'cathedra_id': teacher['cathedra_id']
        },
        'recommendations': {
            'mathematical': math_recommendations,
            'ai': ai_recommendations
        },
        'stats': {
            'total_courses': len(teacher_courses),
            'total_groups': len(teacher_groups),
            'total_types': len(teacher_types),
            'math_count': len(math_recommendations),
            'ai_count': len(ai_recommendations)
        }
    })


@api_bp.route('/getCandidatesForSlot', methods=['POST'])
@handle_db_errors
def get_candidates_for_slot():
    """
    Поиск преподавателей для заданного слота (дата + пара + группа + дисциплина)
    Показывает:
    - Занятых преподавателей (уже есть пара в это время)
    - Свободных преподавателей, которые могут вести эту дисциплину
    - Свободных преподавателей, которые не вели эту дисциплину, но могут
    """
    data = request.get_json()
    date_str = data.get('date')  # YYYY-MM-DD
    pair_index = data.get('pair_index', 0)  # 0-3
    group_id = data.get('group_id')
    course_id = data.get('course_id')
    course_alias = data.get('course_alias')
    cathedra_id = data.get('cathedra_id')

    if not date_str:
        return jsonify({'success': False, 'error': 'Не указана дата'}), 400

    db = DataBase()

    # Определяем день недели и период
    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
    day_of_week = date_obj.isoweekday()  # 1-7

    # Определяем учебный год
    from api.utils.helpers import get_academic_year_info
    from api.utils.database import ScheduleDAO, PeriodDAO

    year_info = get_academic_year_info(date_obj)
    s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

    if not s_year_id:
        return jsonify({'success': False, 'error': 'Не удалось определить учебный год'}), 404

    # Получаем ID периода
    period_id = PeriodDAO.get_by_pair_index(db, s_year_id, pair_index)

    # Получаем ID кафедры из группы, если не указан
    if not cathedra_id and group_id:
        group_info = db.fetchone("SELECT idcathedra FROM groupname WHERE gid = %s", (group_id,))
        if group_info:
            cathedra_id = group_info['idcathedra']

    # Получаем вариант расписания для даты
    sh_var_id = None
    sh_var_query = """
    WITH schedule_variants AS (
        SELECT 
            sh_var_id,
            CASE 
                WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                    TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
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
    result = db.fetchone(sh_var_query, (s_year_id, date_obj.date()))
    if result:
        sh_var_id = result['sh_var_id']

    # 1. Находим занятых преподавателей (уже есть пара в это время)
    busy_teachers = []
    if sh_var_id:
        busy_query = """
        SELECT DISTINCT
            p.mid,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            et.alias as lesson_type,
            cr.alias as course_name,
            gn.name as group_name,
            ns.sheid as schedule_id
        FROM nnz_schedule ns
        JOIN people p ON p.mid = ANY(ns.teacher_mid)
        JOIN eventtools et ON ns.pair_type_id = et.typeid
        JOIN courses cr ON ns.cid = cr.cid
        JOIN groupname gn ON ns.gid = gn.gid
        WHERE ns.sh_var_id = %s
          AND ns.period = %s
          AND ns.day_of_week = %s
        """
        busy_teachers = db.fetchall(busy_query, (sh_var_id, period_id, day_of_week))

    # 2. Находим преподавателей, которые могут вести эту дисциплину (имеют опыт)
    experienced_teachers = []
    if course_id or course_alias:
        course_ids = []
        if course_id:
            course_ids.append(course_id)
        if course_alias:
            alias_courses = db.fetchall("SELECT cid FROM courses WHERE alias = %s", (course_alias,))
            course_ids.extend(c['cid'] for c in alias_courses)

        if course_ids:
            exp_query = """
            SELECT DISTINCT
                p.mid,
                p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
                ad.shortname as degree_short,
                cp.id_pmk,
                COUNT(*) as total_count,
                COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count
            FROM nnz_schedule ns
            JOIN people p ON p.mid = ANY(ns.teacher_mid)
            LEFT JOIN academicdegree ad ON p.degree = ad.agid
            JOIN cathedra_personnel cp ON p.mid = cp.mid
            WHERE ns.cid = ANY(%s)
            """
            params = [group_id or -1, course_ids]

            if cathedra_id:
                exp_query += " AND ns.idcathedra = %s"
                params.append(cathedra_id)

            exp_query += """
            GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
                     ad.shortname, cp.id_pmk
            ORDER BY total_count DESC
            LIMIT 30
            """
            experienced_teachers = db.fetchall(exp_query, tuple(params))

    # 3. Находим всех преподавателей кафедры (потенциальные кандидаты)
    all_cathedra_teachers = []
    if cathedra_id:
        cathedra_query = """
        SELECT DISTINCT
            p.mid,
            p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
            ad.shortname as degree_short,
            cp.id_pmk
        FROM cathedra_personnel cp
        JOIN people p ON p.mid = cp.mid
        LEFT JOIN academicdegree ad ON p.degree = ad.agid
        WHERE cp.cid = %s AND cp.id_pmk IN (1, 2)
        ORDER BY p.lastname, p.firstname
        """
        all_cathedra_teachers = db.fetchall(cathedra_query, (cathedra_id,))

    # Формируем результат
    busy_ids = {t['mid'] for t in busy_teachers}
    experienced_ids = {t['mid'] for t in experienced_teachers}

    # Свободные = все преподаватели кафедры минус занятые
    free_teachers = []
    free_experienced = []
    free_unexperienced = []

    for teacher in all_cathedra_teachers:
        if teacher['mid'] not in busy_ids:
            teacher_info = {
                'id': teacher['mid'],
                'name': teacher['full_name'],
                'degree': teacher['degree_short'],
                'pmk': teacher['id_pmk']
            }

            if teacher['mid'] in experienced_ids:
                # Найдем его статистику
                exp = next((t for t in experienced_teachers if t['mid'] == teacher['mid']), None)
                teacher_info['experience'] = {
                    'total': exp['total_count'] if exp else 0,
                    'same_group': exp['same_group_count'] if exp else 0
                }
                free_experienced.append(teacher_info)
            else:
                free_unexperienced.append(teacher_info)

    return jsonify({
        'success': True,
        'slot_info': {
            'date': date_str,
            'day_of_week': day_of_week,
            'pair_index': pair_index,
            'period_id': period_id,
            'course_id': course_id,
            'group_id': group_id,
            'cathedra_id': cathedra_id
        },
        'busy_teachers': [{
            'id': t['mid'],
            'name': t['full_name'],
            'lesson_type': t['lesson_type'],
            'course': t['course_name'],
            'group': t['group_name'],
            'schedule_id': t['schedule_id']
        } for t in busy_teachers],
        'free_teachers': {
            'experienced': free_experienced,
            'unexperienced': free_unexperienced,
            'total_free': len(free_experienced) + len(free_unexperienced)
        }
    })


@api_bp.route('/findTeachersForCourse', methods=['POST'])
@handle_db_errors
def find_teachers_for_course():
    """
    Поиск преподавателей, которые могут вести выбранную дисциплину.
    Ищет по истории: кто уже вел эту дисциплину, особенно с выбранной группой.
    """
    data = request.get_json()
    course_id = data.get('course_id')
    course_alias = data.get('course_alias', '')
    group_id = data.get('group_id')
    date = data.get('date')
    pair_index = data.get('pair_index', 0)
    type_id = data.get('type_id')

    if not course_id and not course_alias:
        return jsonify({'success': False, 'error': 'Не указана дисциплина'}), 400

    db = DataBase()

    # Собираем ID курсов
    course_ids = []
    if course_id:
        course_ids.append(course_id)
    if course_alias:
        alias_courses = db.fetchall(
            "SELECT cid FROM courses WHERE alias = %s", (course_alias,)
        )
        course_ids.extend(c['cid'] for c in alias_courses)

    if not course_ids:
        return jsonify({'success': False, 'error': 'Дисциплина не найдена'}), 404

    # Определяем период и день недели
    period_id = None
    day_of_week = None

    if date:
        from datetime import datetime
        from api.utils.helpers import get_academic_year_info
        from api.utils.database import ScheduleDAO, PeriodDAO

        date_obj = datetime.strptime(date, '%Y-%m-%d')
        day_of_week = date_obj.isoweekday()
        year_info = get_academic_year_info(date_obj)
        s_year_id = ScheduleDAO.get_study_year_by_date(db, date_obj)

        if s_year_id:
            period_id = PeriodDAO.get_by_pair_index(db, s_year_id, pair_index)

    # Основной запрос: ищем преподавателей, которые вели эту дисциплину
    query = """
    SELECT 
        p.mid,
        p.lastname,
        p.firstname,
        p.patronymic,
        p.lastname || ' ' || p.firstname || ' ' || p.patronymic AS full_name,
        ad.shortname as degree_short,
        ad.agid as degree_id,
        cp.id_pmk,
        COUNT(*) as total_count,
        COUNT(CASE WHEN ns.gid = %s THEN 1 END) as same_group_count,
        COUNT(CASE WHEN ns.pair_type_id = %s THEN 1 END) as same_type_count,
        MAX(
            CASE 
                WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                    TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                    + (ns.day_of_week - 1) * INTERVAL '1 day'
                ELSE NULL
            END
        ) as last_lesson_date
    FROM nnz_schedule ns
    JOIN people p ON p.mid = ANY(ns.teacher_mid)
    LEFT JOIN academicdegree ad ON p.degree = ad.agid
    JOIN cathedra_personnel cp ON p.mid = cp.mid
    LEFT JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
    WHERE ns.cid = ANY(%s)
      AND cp.id_pmk IN (1, 2)
    GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, 
             ad.shortname, ad.agid, cp.id_pmk
    ORDER BY same_group_count DESC, total_count DESC
    LIMIT 20
    """

    teachers = db.fetchall(query, (
        group_id or -1,
        type_id or -1,
        course_ids
    ))

    # Вычисляем оценку соответствия
    max_total = max((t['total_count'] for t in teachers), default=1)
    max_group = max((t['same_group_count'] for t in teachers), default=1)

    recommendations = []
    for t in teachers:
        total = t['total_count'] or 0
        same_group = t['same_group_count'] or 0

        # Нормализованная оценка
        total_score = (total / max_total * 100) if max_total > 0 else 0
        group_score = (same_group / max_group * 100) if max_group > 0 else 0

        # Итоговая оценка: 60% - опыт с группой, 40% - общий опыт
        confidence = group_score * 0.6 + total_score * 0.4

        recommendations.append({
            'mid': t['mid'],
            'full_name': t['full_name'],
            'lastname': t['lastname'],
            'firstname': t['firstname'],
            'patronymic': t['patronymic'],
            'degree_short': t['degree_short'],
            'degree_id': t['degree_id'],
            'id_pmk': t['id_pmk'],
            'total_count': total,
            'same_group_count': same_group,
            'same_type_count': t['same_type_count'],
            'confidence': round(confidence, 1),
            'last_lesson_date': str(t['last_lesson_date'])[:10] if t.get('last_lesson_date') else None,
            'match_score': round(confidence, 1)
        })

    # Сортируем по уверенности
    recommendations.sort(key=lambda x: x['confidence'], reverse=True)

    return jsonify({
        'success': True,
        'recommendations': recommendations,
        'total_count': len(recommendations),
        'criteria': {
            'course_ids': course_ids,
            'group_id': group_id,
            'type_id': type_id,
            'method': 'experience_based'
        }
    })