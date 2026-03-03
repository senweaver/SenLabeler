
from typing import Literal, Any
from ultralytics import YOLOE
from ultralytics.models.sam import SAM3SemanticPredictor
import torch
from PIL import Image, ImageDraw
import numpy as np
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
from transformers import Owlv2Processor, Owlv2ForObjectDetection
import cv2
from utils import rle_encode

grouning_dino_id = "IDEA-Research/grounding-dino-base"
owlv2_id = "google/owlv2-large-patch14-ensemble"

device = 'cuda' if torch.cuda.is_available() else 'cpu'

class PreannotateModel:
    def __init__(self):
        self.model = None
        self.loaded = None
        pass

    def load_model(self, model_name: Literal['yoloe-26', 'sam3', 'grounding-dino', 'owlv2']):
        if self.loaded == model_name:
            return

        if self.loaded is not None:
            self.unload_model()

        if model_name == 'yoloe-26':
            self.model = YOLOE("yoloe-26x-seg.pt")
        if model_name == 'sam3':
            overrides = dict(
                conf=0.25,
                task="segment",
                mode="predict",
                model="sam3.pt",
                half=True,  # Use FP16 for faster inference
                save=True,
            )
            self.model = SAM3SemanticPredictor(overrides=overrides)
        elif model_name == 'grounding-dino':
            self.processor = AutoProcessor.from_pretrained(grouning_dino_id, cache_dir="./models")
            self.model = AutoModelForZeroShotObjectDetection.from_pretrained(grouning_dino_id, cache_dir="./models").to(device)
        elif model_name == 'owlv2':
            self.processor = Owlv2Processor.from_pretrained(owlv2_id, cache_dir="./models")
            self.model = Owlv2ForObjectDetection.from_pretrained(owlv2_id, cache_dir="./models").to(device)
        self.loaded = model_name
    
    def unload_model(self):
        if self.loaded == 'grounding-dino' or self.loaded == 'owlv2':
            del self.processor
            self.processor = None

        del self.model
        self.model = None

        self.loaded = None

    def inference(self, image: Image, prompts: str):
        if self.loaded is None:
            self.load_model('yoloe-26')
        
        prompts = prompts.split('|')
        
        if self.loaded == 'yoloe-26':
            vocab = prompts
            self.model.set_classes(vocab, self.model.get_text_pe(vocab))
            result = self.model.predict(image, device=device)
        elif self.loaded == 'sam3':
            img_np = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
            vocab = prompts
            self.model.set_image(img_np)
            result = self.model(text=vocab)
        elif self.loaded == 'grounding-dino':
            text = ". ".join(prompts) +"."
            inputs = self.processor(image, text, return_tensors="pt").to(device)
            with torch.no_grad():
                outputs = self.model(**inputs)
            result = self.processor.post_process_grounded_object_detection(
                outputs,
                inputs.input_ids,
                text_threshold=0.3,
                target_sizes=[image.size[::-1]]
            )
        elif self.loaded == 'owlv2':
            vocab = prompts
            inputs = self.processor(image, vocab, return_tensors="pt").to(device)
            with torch.no_grad():
                outputs = self.model(**inputs)

            target_sizes = torch.Tensor([image.size[::-1]])
            result = self.processor.post_process_grounded_object_detection(outputs=outputs, target_sizes=target_sizes, threshold=0.1)

        return result
    
    def render_result(self, image, result, mode: Literal['rect', 'mask']):
        if self.loaded == 'yoloe-26':
            img = Image.fromarray(cv2.cvtColor(result[0].plot(), cv2.COLOR_BGR2RGB), "RGB")
            return img
        elif self.loaded == 'sam3':
            img = Image.fromarray(cv2.cvtColor(result[0].plot(), cv2.COLOR_BGR2RGB), "RGB")
            return img
        elif self.loaded == 'grounding-dino' or self.loaded == 'owlv2':
            draw = ImageDraw.Draw(image)

            for box, label, score in zip(result[0]["boxes"], result[0]["labels"], result[0]["scores"]):
                box = box.tolist()
                text = f"{label} {score:.2f}"
                draw.rectangle(box, outline=(255, 0, 0))
                draw.text((box[0], box[1]), text)

            return image

    def decode_result(self, image: Image, result: Any, prompts: str, class_name: str, type: Literal['auto', 'rect', 'mask'] = 'auto'):
        ret = []
        width, height = image.size
        prompts = prompts.split('|')

        if self.loaded == 'yoloe-26' or self.loaded == 'sam3':
            boxes = result[0].boxes.data.tolist()
            masks = result[0].masks.data

            for [x1, y1, x2, y2, score, index], mask in zip(boxes, masks):
                data = mask.cpu().numpy()

                ret.append({
                    "mode": "M",
                    "class": class_name,
                    "score": float(score),
                    "points": [(x1 / width, y1 / height), (x2 / width, y2 / height)],
                    "mask": {'counts': rle_encode(data), 'size': [data.shape[0], data.shape[1]]}
                })
        elif self.loaded == 'grounding-dino':
            for box, label, score in zip(result[0]["boxes"], result[0]["text_labels"], result[0]["scores"]):
                if (label in prompts):
                    box = box.tolist()
                    ret.append({
                        "mode": "R",
                        "class": class_name,
                        "score": float(score),
                        "points": [(box[0] / width, box[1] / height), (box[2] / width, box[3] / height)]
                    })
        elif self.loaded == 'owlv2':
            for box, label, score in zip(result[0]["boxes"], result[0]["labels"], result[0]["scores"]):
                if (label in prompts):
                    box = box.tolist()
                    ret.append({
                        "mode": "R",
                        "class": class_name,
                        "score": float(score),
                        "points": [(box[0] / width, box[1] / height), (box[2] / width, box[3] / height)]
                    })

        return ret