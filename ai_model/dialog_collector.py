# -*- coding: utf-8 -*-
# ai_model/dialog_collector.py
"""Сбор диалогов для обучения NLU-модели"""
import json
import os
from datetime import datetime


class DialogCollector:
    """Сохраняет все диалоги в JSON-файл для будущего обучения"""

    def __init__(self, filepath='training_data/dialogs.json'):
        self.filepath = filepath
        self.dialogs = []
        self._ensure_file()
        self._load()

    def _ensure_file(self):
        os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
        if not os.path.exists(self.filepath):
            with open(self.filepath, 'w', encoding='utf-8') as f:
                json.dump([], f)

    def _load(self):
        try:
            with open(self.filepath, 'r', encoding='utf-8') as f:
                self.dialogs = json.load(f)
        except:
            self.dialogs = []

    def _save(self):
        with open(self.filepath, 'w', encoding='utf-8') as f:
            json.dump(self.dialogs, f, ensure_ascii=False, indent=2)

    def add_dialog(self, question, predicted_intent, actual_intent, was_correct, is_admin):
        """Добавляет диалог в историю"""
        dialog = {
            'timestamp': datetime.now().isoformat(),
            'question': question,
            'predicted_intent': predicted_intent,
            'actual_intent': actual_intent,
            'was_correct': was_correct,
            'is_admin': is_admin,
            'used_for_training': False  # флаг: использовано ли для обучения
        }
        self.dialogs.append(dialog)
        self._save()
        print(f"Dialog saved: '{question}' -> {actual_intent} (correct: {was_correct})")

    def get_training_data(self, min_confidence=0.8):
        """
        Извлекает данные для обучения.
        Берёт только те, где was_correct=True И used_for_training=False
        """
        training = []
        for d in self.dialogs:
            if d['was_correct'] and not d['used_for_training']:
                training.append((d['question'], d['actual_intent']))
                d['used_for_training'] = True

        self._save()
        return training

    def get_stats(self):
        """Статистика собранных данных"""
        total = len(self.dialogs)
        correct = sum(1 for d in self.dialogs if d['was_correct'])
        by_intent = {}
        for d in self.dialogs:
            intent = d['actual_intent']
            by_intent[intent] = by_intent.get(intent, 0) + 1

        return {
            'total': total,
            'correct': correct,
            'accuracy': correct / total if total > 0 else 0,
            'by_intent': by_intent,
            'ready_for_training': sum(1 for d in self.dialogs if d['was_correct'] and not d['used_for_training'])
        }


# Синглтон
dialog_collector = DialogCollector()


def get_dialog_collector():
    return dialog_collector