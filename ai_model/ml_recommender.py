# hybrid_ml_recommender.py
# Гибрид: ML + математический скоринг + онлайн обучение

import os
import pickle
import threading
import time
from collections import deque
from datetime import datetime, timedelta

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import OneHotEncoder
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.compose import ColumnTransformer
from db.database import DataBase


class HybridTeacherRecommender:
    def __init__(self, model_path='hybrid_model.pkl', feedback_buffer_path='feedback_buffer.pkl'):
        self.model_path = model_path
        self.feedback_buffer_path = feedback_buffer_path
        self.model = None
        self.preprocessor = None
        self.vectorizer = None
        self.last_training_date = None

        # Буфер для накопления фидбека
        self.feedback_buffer = deque(maxlen=1000)  # Храним до 1000 примеров
        self.feedback_lock = threading.Lock()

        # Флаги для фонового обучения
        self.is_training = False
        self.training_lock = threading.Lock()

        self.load_model()
        self.load_feedback_buffer()

        # Запускаем фоновый поток для периодического обучения
        self._start_background_trainer()

    def _start_background_trainer(self):
        """Запускает фоновый поток для периодического дообучения"""

        def background_trainer():
            while True:
                time.sleep(3600)  # Проверяем каждый час
                self._check_and_retrain()

        thread = threading.Thread(target=background_trainer, daemon=True)
        thread.start()
        print("Background trainer started")

    def _check_and_retrain(self):
        """Проверяет необходимость дообучения и запускает его"""
        with self.feedback_lock:
            buffer_size = len(self.feedback_buffer)

        # Если накопилось достаточно примеров и модель не обучается
        if buffer_size >= 50 and not self.is_training:
            print(f"Starting auto-retrain with {buffer_size} feedback examples")
            self.retrain_with_feedback(async_mode=True)

    # -------------------- IO --------------------
    def load_model(self):
        if os.path.exists(self.model_path):
            with open(self.model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.preprocessor = data['preprocessor']
                self.vectorizer = data['vectorizer']
                self.last_training_date = data.get('last_training_date')
                print(f"Model loaded: {self.last_training_date}")

    def save_model(self):
        with open(self.model_path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'preprocessor': self.preprocessor,
                'vectorizer': self.vectorizer,
                'last_training_date': datetime.now().isoformat()
            }, f)

    def load_feedback_buffer(self):
        """Загружает сохраненный буфер фидбека"""
        if os.path.exists(self.feedback_buffer_path):
            try:
                with open(self.feedback_buffer_path, 'rb') as f:
                    data = pickle.load(f)
                    self.feedback_buffer = data.get('buffer', deque(maxlen=1000))
                    print(f"Feedback buffer loaded: {len(self.feedback_buffer)} examples")
            except Exception as e:
                print(f"Error loading feedback buffer: {e}")

    def save_feedback_buffer(self):
        """Сохраняет буфер фидбека"""
        try:
            with open(self.feedback_buffer_path, 'wb') as f:
                pickle.dump({'buffer': self.feedback_buffer}, f)
        except Exception as e:
            print(f"Error saving feedback buffer: {e}")

    # -------------------- DATA --------------------
    def get_training_data(self, study_year_id):
        db = DataBase()
        query = """
        SELECT 
            ns.cid, ns.gid, ns.pair_type_id, ns.period, ns.day_of_week, ns.idcathedra,
            unnest(ns.teacher_mid) as teacher_mid,
            c.alias as course_alias,
            c.title as course_title,
            g.name as group_name,
            e.alias as event_type,
            pr.short_time as period_name
        FROM nnz_schedule ns
        JOIN courses c ON ns.cid = c.cid
        JOIN groupname g ON ns.gid = g.gid
        JOIN eventtools e ON ns.pair_type_id = e.typeid
        JOIN periods pr ON ns.period = pr.lid
        WHERE ns.sh_var_id IN (
            SELECT sh_var_id FROM nnz_schedule_variants WHERE s_year_id = %s
        )
        """
        return db.fetchall(query, (study_year_id,))

    def get_recent_schedules(self, days_back=30):
        """Получает недавние записи расписания для дообучения"""
        db = DataBase()
        query = """
        SELECT 
            ns.cid, ns.gid, ns.pair_type_id, ns.period, ns.day_of_week, ns.idcathedra,
            unnest(ns.teacher_mid) as teacher_mid,
            c.alias as course_alias,
            c.title as course_title,
            g.name as group_name,
            e.alias as event_type,
            pr.short_time as period_name
        FROM nnz_schedule ns
        JOIN courses c ON ns.cid = c.cid
        JOIN groupname g ON ns.gid = g.gid
        JOIN eventtools e ON ns.pair_type_id = e.typeid
        JOIN periods pr ON ns.period = pr.lid
        JOIN nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
        WHERE ns.created_at > NOW() - INTERVAL '%s days'
           OR ns.updated_at > NOW() - INTERVAL '%s days'
        LIMIT 5000
        """
        return db.fetchall(query, (days_back, days_back))

    # -------------------- FEATURES --------------------
    def build_dataset(self, data):
        X_struct, X_text, y = [], [], []

        for r in data:
            X_struct.append([
                r['cid'], r['gid'], r['pair_type_id'],
                r['period'], r['day_of_week'], r['idcathedra']
            ])

            text = f"{r.get('course_alias', '')} {r.get('course_title', '')} {r.get('group_name', '')} {r.get('event_type', '')} {r.get('period_name', '')}"
            X_text.append(text)
            y.append(r['teacher_mid'])

        return np.array(X_struct), np.array(X_text), np.array(y)

    def build_single_sample(self, input_data):
        """Создает один сэмпл для предсказания/обучения"""
        X_struct = np.array([[
            input_data['cid'], input_data['gid'], input_data['pair_type_id'],
            input_data['period'], input_data['day_of_week'], input_data['idcathedra']
        ]])

        text = input_data.get('text', '')
        if not text:
            text = self._build_text_from_input(input_data)

        return X_struct, text

    def _build_text_from_input(self, input_data):
        """Строит текстовое описание из входных данных"""
        return f"{input_data.get('course_alias', '')} {input_data.get('course_title', '')} {input_data.get('group_name', '')} {input_data.get('event_type', '')} {input_data.get('period_name', '')}"

    # -------------------- MATH SCORING --------------------
    def math_score(self, stats):
        total = stats.get('total', 1)
        if total == 0:
            return 0
        return (
                (stats.get('same_group', 0) / total) * 0.4 +
                (stats.get('same_type', 0) / total) * 0.25 +
                (stats.get('same_period', 0) / total) * 0.2 +
                (stats.get('same_day', 0) / total) * 0.15
        )

    # -------------------- TRAIN --------------------
    def train(self, study_year_id=None, data=None):
        """Обучение модели"""
        with self.training_lock:
            if self.is_training:
                print("Training already in progress")
                return False
            self.is_training = True

        try:
            if data is None:
                if study_year_id is None:
                    print("No study_year_id or data provided")
                    return False
                data = self.get_training_data(study_year_id)

            if not data or len(data) < 20:
                print(f"Not enough data: {len(data) if data else 0} samples")
                return False

            X_struct, X_text, y = self.build_dataset(data)

            X_train_s, X_test_s, X_train_t, X_test_t, y_train, y_test = train_test_split(
                X_struct, X_text, y, test_size=0.2, random_state=42
            )

            self.preprocessor = ColumnTransformer([
                ('cat', OneHotEncoder(handle_unknown='ignore'), list(range(X_struct.shape[1])))
            ])

            self.vectorizer = TfidfVectorizer(max_features=100)

            X_train_struct = self.preprocessor.fit_transform(X_train_s)
            X_test_struct = self.preprocessor.transform(X_test_s)

            X_train_text = self.vectorizer.fit_transform(X_train_t)
            X_test_text = self.vectorizer.transform(X_test_t)

            X_train = np.hstack([X_train_struct.toarray(), X_train_text.toarray()])
            X_test = np.hstack([X_test_struct.toarray(), X_test_text.toarray()])

            self.model = RandomForestClassifier(n_estimators=200, max_depth=20, n_jobs=-1)
            self.model.fit(X_train, y_train)

            acc = accuracy_score(y_test, self.model.predict(X_test))
            print(f"Training completed. Accuracy: {acc:.3f}, Samples: {len(data)}")

            self.save_model()
            return True

        except Exception as e:
            print(f"Training error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            with self.training_lock:
                self.is_training = False

    # -------------------- HYBRID PREDICT --------------------
    def predict(self, input_data, stats_map=None, top_n=5):
        if not self.model:
            return []

        X_struct, text = self.build_single_sample(input_data)

        X_struct_enc = self.preprocessor.transform(X_struct)
        X_text_vec = self.vectorizer.transform([text])

        X = np.hstack([X_struct_enc.toarray(), X_text_vec.toarray()])

        probs = self.model.predict_proba(X)[0]
        classes = self.model.classes_

        results = []
        for teacher_id, prob in zip(classes, probs):
            math = 0
            if stats_map and teacher_id in stats_map:
                math = self.math_score(stats_map[teacher_id])

            # ГИБРИД
            final_score = prob * 0.7 + math * 0.3

            results.append((teacher_id, final_score))

        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_n]

    # -------------------- ONLINE LEARNING --------------------
    def add_feedback(self, input_data, chosen_teacher_id):
        """
        Добавляет пример в буфер для последующего дообучения
        Вызывается когда пользователь выбрал преподавателя (подтвержденное действие)
        """
        feedback_item = {
            'input_data': input_data.copy(),
            'chosen_teacher_id': chosen_teacher_id,
            'timestamp': datetime.now().isoformat()
        }

        with self.feedback_lock:
            self.feedback_buffer.append(feedback_item)

        # Сохраняем буфер каждые 10 новых примеров
        if len(self.feedback_buffer) % 10 == 0:
            self.save_feedback_buffer()

        print(f"Feedback added. Buffer size: {len(self.feedback_buffer)}")

        # Если накопилось много - запускаем асинхронное дообучение
        if len(self.feedback_buffer) >= 100 and not self.is_training:
            self.retrain_with_feedback(async_mode=True)

    def retrain_with_feedback(self, async_mode=True):
        """
        Дообучает модель на накопленных примерах фидбека

        Args:
            async_mode: если True - запускает обучение в фоновом потоке
        """
        if async_mode:
            thread = threading.Thread(target=self._do_retrain_with_feedback, daemon=True)
            thread.start()
            return True
        else:
            return self._do_retrain_with_feedback()

    def _do_retrain_with_feedback(self):
        """Выполняет дообучение на фидбеке"""
        with self.training_lock:
            if self.is_training:
                print("Training already in progress")
                return False
            self.is_training = True

        try:
            with self.feedback_lock:
                if len(self.feedback_buffer) < 10:
                    print("Not enough feedback for retraining")
                    return False

                # Копируем буфер для обработки
                feedback_items = list(self.feedback_buffer)

            if not self.model:
                print("No model to retrain")
                return False

            print(f"Retraining with {len(feedback_items)} feedback examples")

            # Подготавливаем данные из фидбека
            X_list, y_list = [], []
            for item in feedback_items:
                try:
                    input_data = item['input_data']
                    chosen_teacher = item['chosen_teacher_id']

                    X_struct, text = self.build_single_sample(input_data)

                    X_struct_enc = self.preprocessor.transform(X_struct)
                    X_text_vec = self.vectorizer.transform([text])

                    X = np.hstack([X_struct_enc.toarray(), X_text_vec.toarray()])

                    X_list.append(X[0])
                    y_list.append(chosen_teacher)
                except Exception as e:
                    print(f"Error processing feedback item: {e}")
                    continue

            if not X_list:
                print("No valid feedback items to process")
                return False

            X_feedback = np.array(X_list)
            y_feedback = np.array(y_list)

            # Дообучаем модель
            # Примечание: RandomForest не поддерживает partial_fit,
            # поэтому мы либо:
            # 1. Переобучаем заново на комбинированных данных
            # 2. Используем warm_start (требует пересоздания модели с warm_start=True)

            # Вариант 1: Полное переобучение с учетом старых данных
            self._full_retrain_with_feedback(X_feedback, y_feedback)

            # Очищаем буфер после успешного обучения
            with self.feedback_lock:
                self.feedback_buffer.clear()

            self.save_model()
            self.save_feedback_buffer()

            print(f"Retraining completed successfully")
            return True

        except Exception as e:
            print(f"Retraining error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            with self.training_lock:
                self.is_training = False

    def _full_retrain_with_feedback(self, X_feedback, y_feedback):
        """
        Полное переобучение с учетом старых данных + фидбека
        """
        # Получаем недавние данные из БД
        recent_data = self.get_recent_schedules(days_back=90)

        if recent_data and len(recent_data) > 20:
            # Комбинируем с фидбеком
            X_struct_db, X_text_db, y_db = self.build_dataset(recent_data)

            # Преобразуем данные из БД
            X_struct_enc_db = self.preprocessor.transform(X_struct_db)
            X_text_vec_db = self.vectorizer.transform(X_text_db)
            X_db = np.hstack([X_struct_enc_db.toarray(), X_text_vec_db.toarray()])

            # Объединяем с фидбеком
            X_combined = np.vstack([X_db, X_feedback]) if len(X_db) > 0 else X_feedback
            y_combined = np.concatenate([y_db, y_feedback]) if len(y_db) > 0 else y_feedback

            print(f"Combined dataset: {len(X_combined)} samples (DB: {len(X_db)}, Feedback: {len(X_feedback)})")
        else:
            X_combined = X_feedback
            y_combined = y_feedback
            print(f"Using only feedback data: {len(X_combined)} samples")

        # Создаем новую модель и обучаем
        self.model = RandomForestClassifier(
            n_estimators=200,
            max_depth=20,
            n_jobs=-1,
            random_state=42
        )
        self.model.fit(X_combined, y_combined)

    def force_retrain_from_db(self, study_year_id=None):
        """Принудительное переобучение из БД"""

        def train_thread():
            if study_year_id:
                self.train(study_year_id=study_year_id)
            else:
                # Пробуем получить данные за последние 2 года
                recent_data = self.get_recent_schedules(days_back=365)
                if recent_data:
                    self.train(data=recent_data)
                else:
                    print("No data available for training")

        thread = threading.Thread(target=train_thread, daemon=True)
        thread.start()
        return True

    def get_model_status(self):
        """Возвращает статус модели"""
        with self.feedback_lock:
            buffer_size = len(self.feedback_buffer)

        return {
            'model_loaded': self.model is not None,
            'last_training_date': self.last_training_date,
            'is_training': self.is_training,
            'feedback_buffer_size': buffer_size,
            'model_path': self.model_path
        }


# singleton
recommender = HybridTeacherRecommender()


def init_recommender(study_year_id=None):
    """Инициализирует рекомендательную систему"""
    if not recommender.model:
        print("Модель не найдена, запускаем обучение...")
        if study_year_id:
            recommender.train(study_year_id=study_year_id)
        else:
            recommender.force_retrain_from_db()
    return recommender


def update_recommender_async(study_year_id):
    """Асинхронное обновление модели"""

    def train_thread():
        recommender.train(study_year_id=study_year_id)

    thread = threading.Thread(target=train_thread, daemon=True)
    thread.start()


def add_feedback_to_recommender(input_data, chosen_teacher_id):
    """Добавляет фидбек для онлайн-обучения"""
    recommender.add_feedback(input_data, chosen_teacher_id)


def get_recommender_status():
    """Возвращает статус рекомендательной системы"""
    return recommender.get_model_status()