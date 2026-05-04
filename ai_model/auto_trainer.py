# -*- coding: utf-8 -*-
# ai_model/auto_trainer.py
"""Автоматическое обучение NLU-модели при накоплении данных"""
import threading
import time
from ai_model.dialog_collector import get_dialog_collector
from ai_model.nlu_manager import get_nlu_model


class AutoTrainer:
    """
    Следит за накоплением данных и автоматически обучает модель.
    Работает в фоновом потоке.
    """

    def __init__(self, check_interval=300, min_samples=20):
        """
        Args:
            check_interval: интервал проверки в секундах (5 минут)
            min_samples: минимальное количество новых примеров для обучения
        """
        self.check_interval = check_interval
        self.min_samples = min_samples
        self.running = False
        self.total_trainings = 0

    def start(self):
        """Запускает фоновый мониторинг"""
        if self.running:
            return

        self.running = True

        def monitor():
            while self.running:
                try:
                    self._check_and_train()
                except Exception as e:
                    print(f"AutoTrainer error: {e}")
                time.sleep(self.check_interval)

        thread = threading.Thread(target=monitor, daemon=True)
        thread.start()
        print(f"AutoTrainer started. Check interval: {self.check_interval}s, "
              f"Min samples: {self.min_samples}")

    def stop(self):
        self.running = False

    def _check_and_train(self):
        """Проверяет данные и запускает обучение если нужно"""
        collector = get_dialog_collector()
        training_data = collector.get_training_data()

        if len(training_data) >= self.min_samples:
            print(f"\n{'=' * 50}")
            print(f"🚀 Запуск автоматического обучения!")
            print(f"Новых примеров: {len(training_data)}")

            # Обучаем модель
            nlu = get_nlu_model()
            accuracy = nlu.add_examples(training_data)

            self.total_trainings += 1
            print(f"✅ Обучение завершено! Точность: {accuracy:.2%}")
            print(f"Всего обучений: {self.total_trainings}")
            print(f"{'=' * 50}\n")
        else:
            # Логируем прогресс
            stats = collector.get_stats()
            if stats['total'] > 0:
                print(f"📊 Прогресс сбора данных: {stats['total']} диалогов, "
                      f"{stats['ready_for_training']} готово к обучению "
                      f"(нужно минимум {self.min_samples})")


# Синглтон
auto_trainer = AutoTrainer(check_interval=300, min_samples=20)


def start_auto_trainer():
    """Запускает авто-обучение (вызвать при старте приложения)"""
    auto_trainer.start()


def get_trainer_stats():
    """Возвращает статистику авто-обучения"""
    collector = get_dialog_collector()
    return {
        'total_trainings': auto_trainer.total_trainings,
        'is_running': auto_trainer.running,
        'dialog_stats': collector.get_stats()
    }