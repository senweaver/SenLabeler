import gradio as gr
import os
from ds_config import DatasetConfig
from PIL import Image
from preannotate_model import PreannotateModel
from gradio_image_annotation import image_annotator
from components.detection_viewer import DetectionViewer
from utils import load_annotations, save_annotations

DATA_PATH = './data'
preannotateModel = PreannotateModel()
colors = [
    "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF", "#000000", "#FFFFFF"
]
blank = Image.new("RGB", (1, 1), (0, 0, 0))

def get_datasets():
    return [entry.name for entry in os.scandir(DATA_PATH) if entry.is_dir()]

def dataset_select_change(name, state):
    state['name'] = name
    state['path'] = os.path.join(DATA_PATH, name)

    config_filepath = os.path.join(state['path'], 'config.json')
    state['config'] = DatasetConfig(config_filepath)
    
    image_path = os.path.join(state['path'], 'images')
    images = []
    if not os.path.exists(image_path):
        os.mkdir(image_path)
    for entry in os.scandir(image_path):
        if entry.is_file():
            try:
                image = Image.open(entry.path)
                images.append((image, entry.name))
            except:
                continue
    state['images'] = images

    return state

def dataset_config_type_change(type, state):
    config : DatasetConfig
    config = state['config']
    config.type = type

    config.save_to_file()
    
    return state

def dataset_classes_change(data, state):
    config : DatasetConfig
    config = state['config']
    config.classes = data

    config.save_to_file()
    
    return state

def gallery_select(image_list, state, annotated_state, evt: gr.SelectData):
    index = evt.index
    image, name = image_list[index]

    if annotated_state and annotated_state.get('annotation'):
        file_path = annotated_state['file_path']
        save_annotations(file_path, annotated_state['annotation'])

    image_dir = os.path.join(state['path'], 'images')
    name, _ = os.path.splitext(name)
    annotation_path = os.path.join(image_dir, name + ".txt")

    annotated_state = {
        "file_path": annotation_path,
        "image": image,
        "annotation": load_annotations(annotation_path)
    }
        
    return annotated_state

def annotated_state_change(annotated_state):
    if annotated_state is None:
        return (None, []), gr.update(value=(None, [])), gr.update(value=[]), gr.update(interactive=False)

    image: Image.Image
    image = annotated_state['image']
    annotations = annotated_state.get('annotation', [])

    width, height = image.size
    preannotation = []
    image_annotations = []
    annotation_df = []

    preannotate_result = annotated_state.get('preannotate_result', [])
    for annotation in preannotate_result:
        if annotation['mode'] == 'R':
            points = annotation['points']
            preannotation.append({
                "bbox": {
                    "x": int(round(points[0][0] * width)),
                    "y": int(round(points[0][1] * height)),
                    "width": int(round((points[1][0] - points[0][0]) * width)),
                    "height": int(round((points[1][1] - points[0][1]) * height))
                    },
                "score": annotation['score'],
                "label": annotation['class']
            })
        elif annotation['mode'] == 'M':
            points = annotation['points']
            preannotation.append({
                "bbox": {
                    "x": int(round(points[0][0] * width)),
                    "y": int(round(points[0][1] * height)),
                    "width": int(round((points[1][0] - points[0][0]) * width)),
                    "height": int(round((points[1][1] - points[0][1]) * height))
                    },
                "mask": annotation['mask'],
                "score": annotation['score'],
                "label": annotation['class']
            })

    for id, annotation in enumerate(annotations, 1):
        mode = annotation['mode']
        class_name = annotation['class']

        if mode == 'R':
            points = annotation['points']
            image_annotations.append({
                "bbox": {
                    "x": int(round(points[0][0] * width)),
                    "y": int(round(points[0][1] * height)),
                    "width": int(round((points[1][0] - points[0][0]) * width)),
                    "height": int(round((points[1][1] - points[0][1]) * height))
                    },
                "label": class_name
            })
        elif mode == 'M':
            points = annotation['points']
            image_annotations.append({
                "bbox": {
                    "x": int(round(points[0][0] * width)),
                    "y": int(round(points[0][1] * height)),
                    "width": int(round((points[1][0] - points[0][0]) * width)),
                    "height": int(round((points[1][1] - points[0][1]) * height))
                    },
                "mask": annotation['mask'],
                "label": class_name
            })
        
        annotation_df.append([id, class_name])

    return (image, preannotation), (image, image_annotations), gr.update(value=annotation_df), gr.update(interactive=len(preannotate_result) > 0)


def state_change(state):
    show = state['name'] is not None

    config : DatasetConfig
    config = state['config']

    label_list = []
    label_colors = []
    for index, label in enumerate(config.classes):
        label_list.append(label[0])
        label_colors.append(colors[index % len(colors)])

    return (
        gr.update(value=config.type, visible=True), gr.update(value=config.classes, visible=True),
        gr.update(visible=show), None, state['images'], gr.update(choices=label_list), gr.update(label_list=label_list, label_colors=label_colors),
        gr.update(visible=show)
    )

def preannotate_click(model, prompt, class_name, annotated_state):
    image = annotated_state['image']

    preannotateModel.load_model(model)
    result = preannotateModel.inference(image, prompt)
    decoded_result = preannotateModel.decode_result(image, result, prompt, class_name)

    annotated_state['preannotate_result'] = decoded_result
    return annotated_state

def preannotate_save_click(annotated_state, threshold):
    for annotation in annotated_state['preannotate_result']:
        if annotation["score"] < threshold: continue

        annotated_state['annotation'].append({
            "mode": annotation["mode"],
            "class": annotation["class"],
            "points": annotation["points"],
            "mask": annotation.get("mask")
        })

    save_annotations(annotated_state['file_path'], annotated_state['annotation'])
    gr.Success("操作成功")
    return annotated_state

with gr.Blocks() as app:
    state = gr.State({})
    with gr.Tab("数据集管理") as dataset_tab:
        dataset_refresh_btn = gr.Button("刷新")
        dataset_select = gr.Dropdown(choices = get_datasets(), value=None, label="选择数据集", interactive=True, buttons = [dataset_refresh_btn])
        dataset_config_type = gr.Radio(choices = ["rect", "mask"], value="rect", label="数据集类型", interactive=True, visible=False)
        dataset_config_classes = gr.Dataframe(label="数据集类别", headers=["类别", "提示语"], type="array", interactive=True, visible=False)
    with gr.Tab("工作区", visible=False) as work_tab:
        annotated_state = gr.State(None)
        gallery = gr.Gallery(label="图片", allow_preview=False, columns = 7, height = 200, type="pil", interactive=True)
        with gr.Tab("AI预标注"):
            with gr.Row():
                with gr.Column(scale = 1):
                    preannotate_model = gr.Dropdown(choices = [("[YOLOE-26]支持2D框和遮罩", "yoloe-26"), ("[SAM3]支持2D框和遮罩", "sam3"), ("[Grounding-DINO]仅支持2D框", "grounding-dino"), ("[OWLV2]仅支持2D框", "owlv2")], value=None, label="预标注模型", interactive=True)
                    preannotate_prompt = gr.Textbox(label="预标注提示语(多个词条用|分离)", interactive=True)
                    preannotate_class_name = gr.Dropdown(label="指定类别", interactive=True)
                    preannotate_threshold = gr.Slider(label="阈值(仅影响结果保存)", minimum = 0.0, maximum = 1.0, value = 0.0, step = 0.01, interactive=True)
                    with gr.Row():
                        preannotate_btn = gr.Button("标注当前图片")
                        preannotate_save_btn = gr.Button("保存当前图片标注")
                        preannotate_all_btn = gr.Button("预标注全部图片")
                with gr.Column(scale = 2):
                    preannotate_viewer = DetectionViewer(label="标注预览")
        with gr.Tab("交互式标注"):
            with gr.Row():
                annotated_image = DetectionViewer(label="标注情况")
                annotator = image_annotator(
                    value={"image": blank},
                    label_list=[],
                    label_colors=[],
                    box_thickness = 1,
                    box_selected_thickness = 2,
                    handle_size = 5,
                    label = "图片标注",
                    show_download_button = False,
                    boxes_alpha = 0.4,
                    visible = False)
                annotated_df = gr.Dataframe(label="标注列表", headers=["ID", "类别"], type="array", interactive=True)
            with gr.Row():
                annotate_mode = gr.Dropdown(choices = ["手动", "AI一对一", "AI一对多"], value=None, label="标注模式", interactive=True)
                annotate_model = gr.Dropdown(choices = [], value=None, label="使用模型", interactive=True, visible=False)
    with gr.Tab("导出/训练", visible=False) as export_tab:
        gr.Markdown("导出/训练")

    # events
    dataset_refresh_btn.click(fn=lambda: gr.update(choices = get_datasets(), interactive=True), inputs=None, outputs=[dataset_select])
    dataset_select.change(fn=dataset_select_change, inputs=[dataset_select, state], outputs=[state])
    dataset_config_type.change(fn=dataset_config_type_change, inputs=[dataset_config_type, state], outputs=[state])
    dataset_config_classes.change(fn=dataset_classes_change, inputs=[dataset_config_classes, state], outputs=[state])

    preannotate_btn.click(fn=preannotate_click, inputs=[preannotate_model, preannotate_prompt, preannotate_class_name, annotated_state], outputs=[annotated_state])
    preannotate_save_btn.click(fn=preannotate_save_click, inputs=[annotated_state, preannotate_threshold], outputs=[annotated_state])

    gallery.select(fn=gallery_select, inputs=[gallery, state, annotated_state], outputs=[annotated_state])
    annotated_state.change(annotated_state_change, annotated_state, [preannotate_viewer, annotated_image, annotated_df, preannotate_save_btn])

    state.change(state_change, state, [dataset_config_type, dataset_config_classes, work_tab, annotated_state, gallery, preannotate_class_name, annotator, export_tab])

if __name__ == "__main__":
    app.launch(server_name="0.0.0.0", server_port=8080, share=False)