from typing import Literal
import json

class DatasetConfig():
    path: str
    type: Literal['rect', 'mask']
    classes: list[list[str]]
    def __init__(self, config_path):
        self.path = config_path

        self.load_default()
        self.load_from_file(config_path)

    def load_default(self):
        self.type = 'rect'
        self.classes = {}

    def load_from_file(self, config_path):
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)

            self.type = config.get('type', self.type)
            self.classes = config.get('classes', self.classes)
        except Exception as e:
            print(str(e))

    def save_to_file(self):
        config = { 'type': self.type, 'classes': self.classes }
        with open(self.path, 'w') as f:
            json.dump(config, f)