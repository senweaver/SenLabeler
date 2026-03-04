# Welding Defect Annotation Tool

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)
![Gradio](https://img.shields.io/badge/Gradio-4.0%2B-orange?logo=gradio)
![PyTorch](https://img.shields.io/badge/PyTorch-2.0%2B-red?logo=pytorch)
![License](https://img.shields.io/badge/License-MIT-green)

**基于 AI 预标注的焊接缺陷图像标注工具**

[功能特性](#功能特性) • [快速开始](#快速开始) • [使用指南](#使用指南) • [模型支持](#模型支持) • [项目结构](#项目结构)

</div>

---

## 📖 项目简介

本工具是一个专为焊接缺陷检测设计的图像标注平台，集成了多种先进的视觉大模型，支持 AI 辅助预标注，大幅提升标注效率。基于 Gradio 构建友好的 Web 界面，支持矩形框和遮罩两种标注模式。

## ✨ 功能特性

### 🗂️ 数据集管理
- 创建和管理多个数据集项目
- 支持矩形框（rect）和遮罩（mask）两种标注类型
- 灵活的类别配置，支持为每个类别设置提示语
- 图片批量导入和预览

### 🤖 AI 预标注
集成多种视觉大模型，支持零样本/开放词汇目标检测：

| 模型 | 检测类型 | 特点 |
|------|----------|------|
| **YOLOE-26** | 2D框 + 遮罩 | 实时检测，支持分割 |
| **SAM3** | 2D框 + 遮罩 | 高精度分割模型 |
| **Grounding-DINO** | 2D框 | 开放词汇检测 |
| **OWLV2** | 2D框 | 零样本目标检测 |

### 🖌️ 交互式标注
- 实时可视化标注结果
- 支持手动调整和修正
- 标注列表管理
- 支持置信度阈值过滤

### 💾 数据格式
- 自定义轻量级标注格式
- 支持 RLE 编码的遮罩存储
- 兼容 COCO 格式转换（计划中）

---

## 🚀 快速开始

### 环境要求

- Python 3.8+
- CUDA 11.0+ (推荐，用于 GPU 加速)

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/your-username/welding.git
cd welding

# 安装依赖
pip install -r requirements.txt

# 下载模型文件（可选，首次运行时会自动下载）
# 将模型文件放置在 ./models/ 目录下
```

### 启动服务

```bash
python main.py
```

服务启动后，访问 `http://localhost:8080` 即可使用。

---

## 📚 使用指南

### 1. 创建数据集

在 `./data/` 目录下创建新文件夹作为数据集：

```
data/
├── my_dataset/           # 数据集名称
│   ├── config.json       # 数据集配置
│   └── images/           # 图片目录
│       ├── image1.png
│       ├── image1.txt    # 标注文件（可选）
│       └── ...
```

### 2. 配置数据集

`config.json` 配置示例：

```json
{
    "type": "rect",
    "classes": [
        ["defect_crack", "crack, fissure"],
        ["defect_pore", "pore, hole, void"],
        ["defect_slag", "slag inclusion"]
    ]
}
```

- `type`: 标注类型，可选 `rect`（矩形框）或 `mask`（遮罩）
- `classes`: 类别列表，每个类别包含 `[类别名称, 提示语]`

### 3. AI 预标注流程

1. **选择数据集** - 在"数据集管理"标签页选择要标注的数据集
2. **进入工作区** - 切换到"工作区"标签页
3. **选择图片** - 从图片列表中选择要标注的图片
4. **配置模型** - 选择预标注模型，输入提示语，指定目标类别
5. **执行预标注** - 点击"标注当前图片"按钮
6. **审核调整** - 在标注预览中查看结果，调整置信度阈值
7. **保存标注** - 点击"保存当前图片标注"保存结果

### 4. 标注文件格式

标注文件采用简单文本格式（`.txt`）：

**矩形框格式：**
```
R class_name x1 y1 x2 y2
```

**遮罩格式：**
```
M class_name x1 y1 x2 y2 width height rle_counts
```

其中坐标为归一化坐标（0-1），遮罩使用 RLE 编码。

---

## 🔧 自定义组件

### DetectionViewer

用于显示检测结果的自定义 Gradio 组件：

```python
from components.detection_viewer import DetectionViewer

viewer = DetectionViewer(
    label="检测结果",
    panel_title="检测列表",
    list_height=300,
    score_threshold=(0.3, 1.0)
)

# 输入格式
value = (
    image,  # PIL.Image 或图片路径
    [
        {
            "bbox": {"x": 100, "y": 100, "width": 50, "height": 50},
            "label": "defect",
            "score": 0.95,
            "mask": {"counts": [...], "size": [height, width]}  # 可选
        },
        # ... 更多检测结果
    ]
)
```

### LayerCanvas

多图层画布组件，支持背景图、矩形、遮罩叠加显示：

```python
from components.layer_canvas import LayerCanvas

canvas = LayerCanvas(
    height=500,
    width=None,
    show_controls=True,
    editable=True,
    min_zoom=1.0,
    max_zoom=10.0,
    background_color="#1a1a1a"
)

# 输入格式
value = (
    image,  # PIL.Image 或图片路径
    [
        {
            "mode": "R",  # 矩形框
            "class": "defect",
            "points": [(x1, y1), (x2, y2)]  # 归一化坐标
        },
        {
            "mode": "M",  # 遮罩
            "class": "defect",
            "points": [(x1, y1), (x2, y2)],
            "mask": {"counts": [...], "size": [height, width]}
        }
    ]
)
```

---

## 📁 项目结构

```
welding/
├── main.py                 # 应用入口
├── preannotate_model.py    # AI 模型推理封装
├── ds_config.py            # 数据集配置管理
├── utils.py                # 工具函数
├── requirements.txt        # 依赖列表
│
├── components/             # 自定义 Gradio 组件
│   ├── detection_viewer/   # 检测结果可视化组件
│   │   ├── __init__.py
│   │   └── static/
│   │       ├── script.js
│   │       ├── style.css
│   │       └── template.html
│   └── layer_canvas/       # 多图层画布组件
│       ├── __init__.py
│       └── static/
│           ├── script.js
│           ├── style.css
│           └── template.html
│
├── data/                   # 数据集目录
│   ├── test1/
│   │   ├── config.json
│   │   └── images/
│   └── test2/
│       ├── config.json
│       └── images/
│
├── models/                 # 模型缓存目录
│   ├── models--google--owlv2-large-patch14-ensemble/
│   └── models--IDEA-Research--grounding-dino-base/
│
├── output/                 # 输出目录
└── runs/                   # 运行结果目录
```

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| **Web 框架** | Gradio 4.0+ |
| **深度学习** | PyTorch 2.0+, Ultralytics, Transformers |
| **图像处理** | Pillow, OpenCV, NumPy |
| **标注工具** | pycocotools, gradio-image-annotation |
| **目标检测** | YOLOE, Grounding-DINO, OWLV2 |
| **图像分割** | SAM3 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [Ultralytics](https://github.com/ultralytics/ultralytics) - YOLOE 和 SAM3 模型
- [Hugging Face Transformers](https://github.com/huggingface/transformers) - Grounding-DINO 和 OWLV2 模型
- [Gradio](https://github.com/gradio-app/gradio) - Web 界面框架

---

<div align="center">

**[⬆ 返回顶部](#welding-defect-annotation-tool)**

</div>