# -*- coding: utf-8 -*-
from datetime import datetime
import random

from ai_model.knowledge_engine import get_knowledge_engine
from flask import jsonify, request

from ai_model.nlu_manager import get_nlu_model
from ai_model.site_knowledge import search_knowledge, get_help_text
from ai_model.human_dataset import HUMAN_DATASET
from api import api_bp
from api.utils.decorators import handle_db_errors
from api.schedule_utils import DataBase
from ai_model.dialog_collector import get_dialog_collector

# ==================== HUMAN-LIKE ANSWERS ====================

HUMAN_ANSWERS = {}
for item in HUMAN_DATASET:
    if item['intent'] not in HUMAN_ANSWERS:
        HUMAN_ANSWERS[item['intent']] = []
    HUMAN_ANSWERS[item['intent']].append(item['answer'])


def get_human_answer(intent):
    """Возвращает случайный human-like ответ для намерения"""
    if intent in HUMAN_ANSWERS:
        answers = HUMAN_ANSWERS[intent]
        if answers:
            return random.choice(answers)
    return None


class AIAssistant:
    """
    AI-ассистент для расписания и нагрузки.
    Работает полностью локально, используя существующие БД и модели.
    """

    def __init__(self):
        self.context = {}

    def process(self, question: str, is_admin: bool, context: dict = None) -> dict:
        print(f"🔥 PROCESS: '{question}', admin={is_admin}")

        if context:
            self.context = context

        q = question.lower().strip()

        # Определяем намерение (ML + правила)
        intent = self._detect_intent(question)

        try:
            result = None

            if intent == 'next_lesson_group':
                result = self._handle_next_lesson_group(question)
            elif intent == 'next_lesson_teacher':
                result = self._handle_next_lesson_teacher(question)
            elif intent == 'today_schedule':
                result = self._handle_today_schedule(question)
            elif intent == 'find_group':
                result = self._handle_find_group(question)
            elif intent == 'workload':
                result = self._handle_workload(question, is_admin)
            elif intent == 'swap_recommendation':
                result = self._handle_swap_recommendation(question, is_admin)
            elif intent == 'help':
                result = self._handle_help(is_admin)
            elif intent == 'list_groups':
                result = self._handle_list_groups(question)
            elif intent == 'greeting':
                result = self._handle_greeting(is_admin)
            elif intent == 'free_teachers':
                result = self._handle_free_teachers(question)
            elif intent == 'find_room':
                result = self._handle_find_room(question)
            elif intent == 'site_knowledge':
                kb_result = search_knowledge(question, is_admin)
                if kb_result:
                    result = kb_result
                else:
                    result = self._handle_fallback(question, is_admin)
            else:
                result = self._handle_fallback(question, is_admin)

            result['intent'] = intent
            return result

        except Exception as e:
            print(f"Assistant error: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'answer': '😔 Ой! Что-то пошло не так. Попробуйте переформулировать вопрос.',
                'error': str(e)
            }

    def _detect_intent(self, q: str) -> str:
        """ML-предсказание с fallback на правила"""
        nlu = get_nlu_model()

        # Пробуем ML
        if nlu.classifier:
            try:
                intent, proba = nlu.predict(q, return_proba=True)
                confidence = proba.get(intent, 0)

                if confidence > 0.5:
                    print(f"🤖 ML: '{q}' → {intent} ({confidence:.1%})")
                    return intent
            except Exception as e:
                print(f"ML prediction failed: {e}")

        # Fallback на правила
        print(f"📏 Rules for: '{q}'")
        return self._detect_by_rules(q)

    def _detect_by_rules(self, q: str) -> str:
        """Правила для сложных случаев"""
        q_lower = q.lower().strip()
        q_original = q.strip()
        ke = get_knowledge_engine()

        # Фамилия с большой буквы
        for word in q_original.split():
            clean = word.strip('.,!?')
            if len(clean) > 3 and 'А' <= clean[0] <= 'Я':
                if not ke.extract_number(q_lower):
                    return 'next_lesson_teacher'

        # Приветствия
        if any(w in q_lower for w in
               ['привет', 'здравствуй', 'добрый', 'hi', 'hello', 'ку', 'здарова', 'как дела', 'как жизнь']):
            return 'greeting'

        # Помощь
        if any(w in q_lower for w in ['помощь', 'умеешь', 'help', 'команды', 'функции', 'возможности']):
            return 'help'

        # Сегодня
        if any(w in q_lower for w in ['сегодня', 'сейчас']):
            return 'today_schedule'

        # Группа
        group_num = ke.extract_number(q_lower)
        if group_num:
            if any(w in q_lower for w in ['где', 'найти', 'какая', 'информация']):
                return 'find_group'
            return 'next_lesson_group'

        # Свободные
        if any(w in q_lower for w in ['свободен', 'свободные', 'кто может', 'не занят']):
            return 'free_teachers'

        # Аудитория
        if any(w in q_lower for w in ['аудитория', 'кабинет', 'где находится', 'в каком']):
            return 'find_room'

        # Список групп
        if any(w in q_lower for w in ['список групп', 'все группы', 'перечисли']):
            return 'list_groups'

        # Нагрузка
        if any(w in q_lower for w in ['нагрузка', 'статистика', 'загруженность', 'сколько часов']):
            return 'workload'

        # Замена
        if any(w in q_lower for w in ['замена', 'рекомендац', 'порекомендуй', 'кого поставить']):
            return 'swap_recommendation'

        # База знаний сайта
        kb_result = search_knowledge(q_lower, is_admin=False)
        if kb_result:
            return 'site_knowledge'

        return 'fallback'

    # ==================== ОБРАБОТЧИКИ ====================

    def _handle_greeting(self, is_admin: bool) -> dict:
        human = get_human_answer('greeting')
        if human:
            return {'success': True, 'answer': human}

        role = 'администратор' if is_admin else 'пользователь'
        greetings = [
            f"👋 Привет-привет, {role}! Чем могу помочь?",
            f"😊 Здравствуйте! Что интересует по расписанию?",
            f"🦉 Доброго времени! Я на связи. Спрашивайте!",
        ]
        return {'success': True, 'answer': random.choice(greetings)}

    def _handle_help(self, is_admin: bool) -> dict:
        human = get_human_answer('help')
        if human:
            return {'success': True, 'answer': human}
        return {'success': True, 'answer': get_help_text(is_admin)}

    def _handle_next_lesson_group(self, q: str) -> dict:
        import re
        group_match = re.search(r'(\d{3,4})', q)
        if not group_match:
            return {'success': True, 'answer': '🤔 Укажите номер группы (например, 1290), и я найду ближайшую пару!'}

        group_number = group_match.group(1)
        db = DataBase()
        ke = get_knowledge_engine()

        group_info = ke.get_group_info(group_number, db)
        if not group_info:
            return {'success': True,
                    'answer': f'🔍 Группа {group_number} не найдена. Проверьте номер и попробуйте снова.'}

        lesson = ke.get_next_lesson_for_group(group_info['gid'], db)

        if lesson and lesson.get('event_date'):
            if hasattr(lesson['event_date'], 'strftime'):
                date_str = lesson['event_date'].strftime('%d.%m.%Y')
            else:
                date_str = str(lesson['event_date'])[:10]

            templates = [
                f"📅 Группа **{group_info['name']}**, ближайшая пара:\n📆 {date_str}\n🕐 {lesson.get('period_name', '—')}\n📚 {lesson.get('course_alias', lesson.get('course_title', '—'))}\n👨‍🏫 {lesson.get('teacher_name', '—')}\n🏫 {lesson.get('room_name', '—')}",
                f"🔍 Нашёл! **{group_info['name']}**:\n{date_str} — {lesson.get('period_name', '—')}\n{lesson.get('course_alias', '—')} ({lesson.get('event_type', '—')})\nВедёт: {lesson.get('teacher_name', '—')}\nКабинет: {lesson.get('room_name', '—')}",
                f"🎓 **{group_info['name']}**, готовьтесь:\n📆 {date_str} | 🕐 {lesson.get('period_name', '—')}\n📚 {lesson.get('course_alias', '—')}\n👨‍🏫 {lesson.get('teacher_name', '—')}",
            ]
            answer = random.choice(templates)
        else:
            answer = f'📭 У группы {group_info["name"]} пока нет пар в расписании. Возможно, расписание ещё не загружено.'

        return {
            'success': True,
            'answer': answer,
            'context': {'last_group': group_info['gid'], 'last_group_name': group_info['name']}
        }

    def _handle_next_lesson_teacher(self, q: str) -> dict:
        db = DataBase()
        ke = get_knowledge_engine()

        teacher_name = ke.extract_teacher_name(q)
        if not teacher_name:
            for word in q.split():
                clean = word.strip('.,!?')
                if len(clean) > 3 and ('А' <= clean[0] <= 'Я' or clean[0].isupper()):
                    teacher_name = clean
                    break

        if not teacher_name:
            return {'success': True,
                    'answer': '🤔 Укажите фамилию преподавателя (например: Иванов, Петрова), и я найду ближайшую пару!'}

        teacher_info = ke.get_teacher_info(teacher_name, db)
        if not teacher_info:
            return {'success': True, 'answer': f'🔍 Преподаватель "{teacher_name}" не найден. Проверьте фамилию.'}

        lesson = ke.get_next_lesson_for_teacher(teacher_info['mid'], db)

        if lesson and lesson.get('event_date'):
            if hasattr(lesson['event_date'], 'strftime'):
                date_str = lesson['event_date'].strftime('%d.%m.%Y')
            else:
                date_str = str(lesson['event_date'])[:10]

            templates = [
                f"👨‍🏫 **{teacher_info['full_name']}**, ближайшая пара:\n📆 {date_str}\n🕐 {lesson.get('period_name', '—')}\n📚 {lesson.get('course_alias', lesson.get('course_title', '—'))}\n👥 {lesson.get('group_name', '—')}\n🏫 {lesson.get('room_name', '—')}",
                f"📅 Нашёл! {teacher_info['full_name']}:\n{date_str} — {lesson.get('period_name', '—')}\n{lesson.get('course_alias', '—')}\nГруппа: {lesson.get('group_name', '—')}",
            ]
            answer = random.choice(templates)
        else:
            answer = f'📭 У преподавателя {teacher_info["full_name"]} пока нет пар в расписании.'

        return {
            'success': True,
            'answer': answer,
            'context': {'last_teacher': teacher_info['mid'], 'last_teacher_name': teacher_info['full_name']}
        }

    def _handle_today_schedule(self, q: str) -> dict:
        db = DataBase()
        ke = get_knowledge_engine()
        today_data = ke.get_today_summary(db)

        if today_data['is_weekend']:
            weekend_msgs = [
                f'🎉 Сегодня {today_data["day_name"]}! Пар нет. Отдыхайте!',
                f'😴 {today_data["day_name"]} — законный выходной. Никаких пар!',
                f'🏖️ Сегодня {today_data["day_name"]}. Наслаждайтесь отдыхом!',
            ]
            return {'success': True, 'answer': random.choice(weekend_msgs)}

        if today_data['total_pairs'] == 0:
            return {'success': True, 'answer': '📅 Сегодня пар нет. Можно заняться другими делами! 📚'}

        answer = f"📅 **Сегодня** ({today_data['total_pairs']} пар):\n\n"
        for i, pair in enumerate(today_data.get('pairs', [])[:8], 1):
            answer += f"{i}. 🕐 {pair['period']} — {pair['course']} ({pair['type']})\n   👨‍🏫 {pair['teacher']} | 👥 {pair['group_name']} | 🏫 {pair.get('room', '—')}\n\n"

        if today_data['total_pairs'] > 8:
            answer += f"…и ещё {today_data['total_pairs'] - 8} пар. Откройте расписание для полного списка."

        return {'success': True, 'answer': answer}

    def _handle_find_group(self, q: str) -> dict:
        import re
        group_match = re.search(r'(\d{3,4})', q)
        if not group_match:
            return {'success': True, 'answer': 'Укажите номер группы для поиска (например, 1290).'}

        group_number = group_match.group(1)
        db = DataBase()
        groups = db.fetchall(
            "SELECT gid, name, idfaculty FROM groupname WHERE name LIKE %s LIMIT 10",
            (f'%{group_number}%',)
        )

        if not groups:
            return {'success': True, 'answer': f'🔍 Группы с номером {group_number} не найдены.'}

        answer = f"🔍 Найденные группы ({len(groups)}):\n\n"
        for g in groups:
            answer += f"• **{g['name']}** (ID: {g['gid']})\n"

        return {'success': True, 'answer': answer}

    def _handle_list_groups(self, q: str) -> dict:
        human = get_human_answer('list_groups')
        if human:
            return {'success': True, 'answer': human}

        db = DataBase()
        groups = db.fetchall("SELECT name FROM groupname ORDER BY name LIMIT 20")
        answer = "📋 Список групп (первые 20):\n\n"
        for g in groups:
            answer += f"• {g['name']}\n"
        answer += "\n🔍 Для поиска: «Где группа [номер]?»"
        return {'success': True, 'answer': answer}

    def _handle_workload(self, q: str, is_admin: bool) -> dict:
        if not is_admin:
            return {'success': True,
                    'answer': '📊 Нагрузка доступна только администраторам. Перейдите на страницу /workload.'}

        human = get_human_answer('workload')
        if human:
            return {'success': True, 'answer': human}

        return {'success': True, 'answer': '📊 Откройте страницу /workload для детальной статистики.'}

    def _handle_swap_recommendation(self, q: str, is_admin: bool) -> dict:
        if not is_admin:
            return {'success': True, 'answer': '🔄 Замены доступны только администраторам.'}

        human = get_human_answer('swap_recommendation')
        if human:
            return {'success': True, 'answer': human}

        return {'success': True, 'answer': '🔄 Нажмите «Замена» на странице расписания, выберите пару и я помогу!'}

    def _handle_free_teachers(self, q: str) -> dict:
        import re
        db = DataBase()
        ke = get_knowledge_engine()
        today = datetime.now().strftime('%Y-%m-%d')

        pair_match = re.search(r'(\d)[-я]\s*пара|пар[ау]\s*(\d)', q.lower())
        pair_index = 0
        if pair_match:
            num = pair_match.group(1) or pair_match.group(2)
            pair_index = min(3, max(0, int(num) - 1))

        free = ke.search_free_teachers(today, pair_index, db)

        if free:
            answer = f"🟢 Свободны на сегодня ({pair_index + 1}-я пара):\n\n"
            for t in free[:8]:
                answer += f"• {t['full_name']} (ПМК {t.get('id_pmk', '?')})\n"
            if len(free) > 8:
                answer += f"\n…и ещё {len(free) - 8} преподавателей."
        else:
            answer = "🔴 Все преподаватели заняты в это время."

        return {'success': True, 'answer': answer}

    def _handle_find_room(self, q: str) -> dict:
        import re
        db = DataBase()
        room_match = re.search(r'(\d+[кКдД]?\w*)', q)

        if room_match:
            room_query = room_match.group(1)
            rooms = db.fetchall(
                "SELECT rid, name, short_name FROM rooms WHERE short_name ILIKE %s LIMIT 5",
                (f'%{room_query}%',)
            )
        else:
            rooms = db.fetchall("SELECT rid, name, short_name FROM rooms ORDER BY short_name LIMIT 10")

        if rooms:
            answer = f"🏫 Аудитории ({len(rooms)}):\n\n"
            for r in rooms:
                answer += f"• **{r['short_name']}** — {r['name']}\n"
        else:
            answer = f"🔍 Аудитория '{room_query}' не найдена."

        return {'success': True, 'answer': answer}

    def _handle_fallback(self, q: str, is_admin: bool) -> dict:
        human = get_human_answer('fallback')
        if human:
            return {'success': True, 'answer': human}

        tips = [
            '• «Когда ближайшая пара у группы 1290?»',
            '• «Какие пары сегодня?»',
            '• «Когда пара у Иванова?»',
        ]
        if is_admin:
            tips += ['• «Порекомендуй замену»', '• «Покажи нагрузку»']

        return {
            'success': True,
            'answer': '🤔 Я не совсем понял. Попробуйте:\n' + '\n'.join(tips) + '\n\nИли спросите «Что ты умеешь?»'
        }


# ==================== SINGLETON ====================
assistant = AIAssistant()


# ==================== API ENDPOINTS ====================

@api_bp.route('/assistant/ask', methods=['POST'])
@handle_db_errors
def assistant_ask():
    data = request.get_json() or {}
    question = data.get('question', '')
    is_admin = data.get('is_admin', False)
    context = data.get('context', {})

    if not question:
        return jsonify({'success': False, 'error': 'Empty question'}), 400

    result = assistant.process(question, is_admin, context)
    return jsonify(result)


@api_bp.route('/assistant/feedback', methods=['POST'])
@handle_db_errors
def assistant_feedback():
    data = request.get_json() or {}
    question = data.get('question', '')
    predicted_intent = data.get('predicted_intent', '')
    correct_intent = data.get('correct_intent', '')
    was_helpful = data.get('was_helpful', True)
    is_admin = data.get('is_admin', False)

    collector = get_dialog_collector()

    if was_helpful:
        collector.add_dialog(question, predicted_intent, predicted_intent, True, is_admin)
        message = 'Спасибо! Ответ сохранён.'
    else:
        if correct_intent:
            collector.add_dialog(question, predicted_intent, correct_intent, True, is_admin)
            message = f'Исправлено (→ {correct_intent}). Спасибо!'
        else:
            collector.add_dialog(question, predicted_intent, 'unknown', False, is_admin)
            message = 'Ошибка зафиксирована. Спасибо!'

    return jsonify({'success': True, 'message': message})


@api_bp.route('/assistant/training-stats', methods=['GET'])
@handle_db_errors
def training_stats():
    collector = get_dialog_collector()
    return jsonify(collector.get_stats())


@api_bp.route('/assistant/debug', methods=['GET'])
@handle_db_errors
def assistant_debug():
    nlu = get_nlu_model()
    if not nlu.classifier:
        return jsonify({'error': 'Модель не обучена'})

    tests = ["привет", "что ты умеешь", "какие пары сегодня", "когда пара у группы 1290",
             "когда пара у иванова", "где группа 444", "список групп", "покажи нагрузку",
             "кого поставить на замену"]

    results = []
    for phrase in tests:
        intent, proba = nlu.predict(phrase, return_proba=True)
        results.append({'phrase': phrase, 'predicted': intent, 'confidence': proba.get(intent, 0), 'all_proba': proba})

    return jsonify({'intents': nlu.intents, 'model_type': type(nlu.classifier).__name__, 'results': results})


@api_bp.route('/assistant/retrain', methods=['POST'])
@handle_db_errors
def force_retrain_nlu():
    collector = get_dialog_collector()
    all_correct = [(d['question'], d['actual_intent']) for d in collector.dialogs
                   if d['was_correct'] and d['actual_intent'] != 'unknown']

    if len(all_correct) < 5:
        return jsonify(
            {'success': False, 'error': f'Мало данных. Правильных примеров: {len(all_correct)}. Нужно минимум 5.'})

    nlu = get_nlu_model()
    accuracy = nlu.add_examples(all_correct)

    for d in collector.dialogs:
        if d['was_correct']:
            d['used_for_training'] = True
    collector._save()

    return jsonify({'success': True, 'accuracy': f'{accuracy:.1%}', 'samples_used': len(all_correct)})


@api_bp.route('/assistant/invalidate-cache', methods=['GET'])
@handle_db_errors
def invalidate_cache():
    from ai_model.knowledge_engine import invalidate_knowledge_cache
    invalidate_knowledge_cache()
    return jsonify({'success': True, 'message': 'Кэш сброшен'})


@api_bp.route('/assistant/dashboard', methods=['GET'])
@handle_db_errors
def assistant_dashboard():
    from ai_model.auto_trainer import get_trainer_stats
    collector = get_dialog_collector()
    stats = collector.get_stats()
    trainer_stats = get_trainer_stats()
    recent = collector.dialogs[-10:] if collector.dialogs else []

    return jsonify({
        'data_stats': {
            'total_dialogs': stats['total'],
            'correct_predictions': stats['correct'],
            'accuracy': f"{stats['accuracy']:.1%}",
            'ready_for_training': stats['ready_for_training'],
        },
        'trainer': {'total_trainings': trainer_stats['total_trainings'], 'is_running': trainer_stats['is_running']},
        'recent_dialogs': [{'question': d['question'], 'intent': d['actual_intent'], 'correct': d['was_correct'],
                            'time': d['timestamp']} for d in recent]
    })


@api_bp.route('/assistant/debug-next-lesson', methods=['GET'])
@handle_db_errors
def debug_next_lesson():
    from ai_model.knowledge_engine import get_knowledge_engine
    from api.schedule_utils import DataBase
    group_num = request.args.get('group', '1290')
    db = DataBase()
    ke = get_knowledge_engine()
    ke.invalidate_cache()
    group_info = ke.get_group_info(group_num, db)
    if not group_info:
        return jsonify({'error': f'Group {group_num} not found'})
    lesson = ke.get_next_lesson_for_group(group_info['gid'], db)
    return jsonify({
        'group': group_info,
        'lesson': lesson,
        'lesson_date': str(lesson.get('event_date')) if lesson and lesson.get('event_date') else None,
        'today': datetime.now().isoformat(),
        'day_of_week': datetime.now().isoweekday()
    })